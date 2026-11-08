export type MtdomBasicPatient = Readonly<{
  tipo_identificacion: string;
  identificacion: string;
  primer_nombre: string | null;
  segundo_nombre: string | null;
  primer_apellido: string | null;
  segundo_apellido: string | null;
  sexo: string | null;
  ciudad: string | null;
  codigo_ciudad: string | null;
  departamento: string | null;
  codigo_departamento: string | null;
  eps: string | null;
  codigo_eps: string | null;
  plan: string | null;
  codigo_plan: string | null;
  tipo: string | null;
  codigo_tipo: string | null;
  condicion: string | null;
  activo: boolean | null;
  paciente_vivo: boolean | null;
  fecha_fallecimiento: string | null;
  presente_en_fuente_actual: boolean | null;
  registraduria_estado: string | null;
  fecha_ultima_validacion_registraduria: string | null;
  actualizado_en: string;
}>;

type MtdomErrorEnvelope = Readonly<{ ok: false; error: string; message: string }>;
export type MtdomLookupResponse =
  | Readonly<{
      kind: 'FOUND';
      patient: MtdomBasicPatient;
      diagnosticRequestId?: string;
    }>
  | Readonly<{ kind: 'NOT_FOUND'; diagnosticRequestId?: string }>
  | Readonly<{ kind: 'AMBIGUOUS'; diagnosticRequestId?: string }>;

export class MtdomPatientsReadError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly retryAfterMs?: number,
    readonly diagnosticRequestId?: string,
  ) {
    super(`MTDOM_${code}`);
    this.name = 'MtdomPatientsReadError';
  }
}

export type MtdomPatientsReadClientOptions = Readonly<{
  token: string;
  timeoutMs: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}>;

const API_BASE_URL = 'https://api.mtdom.com';
const MTDOM_DOCUMENT_TYPE_MAX_LENGTH = 10;
const MTDOM_DOCUMENT_VALUE_MAX_LENGTH = 30;
const MAX_RETRY_AFTER_MS = 5 * 60 * 1000;
const MTDOM_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASIC_PATIENT_FIELDS = [
  'tipo_identificacion',
  'identificacion',
  'primer_nombre',
  'segundo_nombre',
  'primer_apellido',
  'segundo_apellido',
  'sexo',
  'ciudad',
  'codigo_ciudad',
  'departamento',
  'codigo_departamento',
  'eps',
  'codigo_eps',
  'plan',
  'codigo_plan',
  'tipo',
  'codigo_tipo',
  'condicion',
  'activo',
  'paciente_vivo',
  'fecha_fallecimiento',
  'presente_en_fuente_actual',
  'registraduria_estado',
  'fecha_ultima_validacion_registraduria',
  'actualizado_en',
] as const;
const TEXT_PATIENT_FIELDS = BASIC_PATIENT_FIELDS.filter(
  (field) =>
    !['activo', 'paciente_vivo', 'presente_en_fuente_actual', 'actualizado_en'].includes(field),
);
const BOOLEAN_PATIENT_FIELDS = ['activo', 'paciente_vivo', 'presente_en_fuente_actual'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function characterLength(value: string): number {
  return Array.from(value).length;
}

function parseBasicPatient(value: unknown): MtdomBasicPatient | null {
  if (!isRecord(value)) return null;
  if (
    Object.keys(value).length !== BASIC_PATIENT_FIELDS.length ||
    Object.keys(value).some(
      (key) => !BASIC_PATIENT_FIELDS.includes(key as (typeof BASIC_PATIENT_FIELDS)[number]),
    )
  ) {
    return null;
  }
  if (
    typeof value.tipo_identificacion !== 'string' ||
    value.tipo_identificacion.trim().length < 1 ||
    characterLength(value.tipo_identificacion) > MTDOM_DOCUMENT_TYPE_MAX_LENGTH
  )
    return null;
  if (
    typeof value.identificacion !== 'string' ||
    value.identificacion.trim().length < 1 ||
    characterLength(value.identificacion) > MTDOM_DOCUMENT_VALUE_MAX_LENGTH
  )
    return null;
  for (const field of TEXT_PATIENT_FIELDS) {
    const fieldValue = value[field];
    if (
      field !== 'tipo_identificacion' &&
      field !== 'identificacion' &&
      fieldValue !== null &&
      (typeof fieldValue !== 'string' || fieldValue.length > 2048)
    )
      return null;
  }
  for (const field of BOOLEAN_PATIENT_FIELDS) {
    if (value[field] !== null && typeof value[field] !== 'boolean') return null;
  }
  if (
    typeof value.actualizado_en !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(value.actualizado_en) ||
    !Number.isFinite(Date.parse(value.actualizado_en))
  )
    return null;
  return value as MtdomBasicPatient;
}

function parseErrorEnvelope(value: unknown): MtdomErrorEnvelope | null {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== 3 ||
    value.ok !== false ||
    typeof value.error !== 'string' ||
    value.error.length < 1 ||
    value.error.length > 100 ||
    typeof value.message !== 'string' ||
    value.message.length > 500
  )
    return null;
  return value as MtdomErrorEnvelope;
}

function readDiagnosticRequestId(response: Response): string | undefined {
  const value = response.headers.get('x-request-id');
  if (!value || !MTDOM_REQUEST_ID_PATTERN.test(value)) return undefined;
  return value.toLowerCase();
}

function safeRetryAfterMs(value: string | null, nowMs: number): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, Math.ceil(seconds * 1000)));
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(1000, timestamp - nowMs));
}

export class MtdomPatientsReadClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: MtdomPatientsReadClientOptions) {
    let parsed: URL;
    try {
      parsed = new URL(options.baseUrl ?? API_BASE_URL);
    } catch {
      throw new MtdomPatientsReadError('INVALID_BASE_URL', false);
    }
    if (
      parsed.protocol !== 'https:' ||
      parsed.hostname !== 'api.mtdom.com' ||
      parsed.port !== '' ||
      parsed.username !== '' ||
      parsed.password !== '' ||
      parsed.pathname !== '/' ||
      parsed.search !== '' ||
      parsed.hash !== ''
    ) {
      throw new MtdomPatientsReadError('INVALID_BASE_URL', false);
    }
    if (!options.token.trim() || !Number.isInteger(options.timeoutMs) || options.timeoutMs < 100) {
      throw new MtdomPatientsReadError('INVALID_CLIENT_CONFIGURATION', false);
    }
    this.baseUrl = parsed.origin;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async lookup(
    identity: Readonly<{ documentType: string; documentValue: string }>,
  ): Promise<MtdomLookupResponse> {
    const body = {
      tipo_identificacion: identity.documentType,
      identificacion: identity.documentValue,
      profile: 'basic',
    };
    if (
      !identity.documentType ||
      !identity.documentType.trim() ||
      characterLength(identity.documentType.trim()) > MTDOM_DOCUMENT_TYPE_MAX_LENGTH ||
      !identity.documentValue ||
      !identity.documentValue.trim() ||
      characterLength(identity.documentValue.trim()) > MTDOM_DOCUMENT_VALUE_MAX_LENGTH
    ) {
      throw new MtdomPatientsReadError('INVALID_LOCAL_IDENTITY', false);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/v1/patients/lookup`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.options.token}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        cache: 'no-store',
        redirect: 'error',
        signal: controller.signal,
      });
      return await this.interpretResponse(response);
    } catch (error) {
      if (error instanceof MtdomPatientsReadError) throw error;
      if (controller.signal.aborted) {
        throw new MtdomPatientsReadError('TIMEOUT', true);
      }
      throw new MtdomPatientsReadError('CONNECTION_FAILURE', true);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async interpretResponse(response: Response): Promise<MtdomLookupResponse> {
    const diagnosticRequestId = readDiagnosticRequestId(response);
    if (response.status === 401 || response.status === 403) {
      throw new MtdomPatientsReadError('AUTH_BLOCKED', false, undefined, diagnosticRequestId);
    }
    if (response.status === 404 || response.status === 409) {
      const error = await this.readErrorEnvelope(response, diagnosticRequestId);
      if (response.status === 404 && error.error === 'PATIENT_NOT_FOUND')
        return { kind: 'NOT_FOUND', ...(diagnosticRequestId ? { diagnosticRequestId } : {}) };
      if (response.status === 409 && error.error === 'AMBIGUOUS_PATIENT_IDENTITY')
        return { kind: 'AMBIGUOUS', ...(diagnosticRequestId ? { diagnosticRequestId } : {}) };
      throw new MtdomPatientsReadError(
        'UNEXPECTED_ERROR_RESPONSE',
        false,
        undefined,
        diagnosticRequestId,
      );
    }
    if (response.status === 429) {
      throw new MtdomPatientsReadError(
        'RATE_LIMITED',
        true,
        safeRetryAfterMs(response.headers.get('retry-after'), Date.now()),
        diagnosticRequestId,
      );
    }
    if (response.status >= 500)
      throw new MtdomPatientsReadError('REMOTE_SERVER_ERROR', true, undefined, diagnosticRequestId);
    if (response.status !== 200)
      throw new MtdomPatientsReadError(
        'UNEXPECTED_HTTP_STATUS',
        false,
        undefined,
        diagnosticRequestId,
      );
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new MtdomPatientsReadError(
        'UNEXPECTED_CONTENT_TYPE',
        false,
        undefined,
        diagnosticRequestId,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MtdomPatientsReadError(
        'INVALID_JSON_RESPONSE',
        false,
        undefined,
        diagnosticRequestId,
      );
    }
    if (!isRecord(payload) || Object.keys(payload).length !== 2 || payload.ok !== true) {
      throw new MtdomPatientsReadError(
        'INVALID_SUCCESS_RESPONSE',
        false,
        undefined,
        diagnosticRequestId,
      );
    }
    const patient = parseBasicPatient(payload.data);
    if (!patient)
      throw new MtdomPatientsReadError(
        'INVALID_SUCCESS_RESPONSE',
        false,
        undefined,
        diagnosticRequestId,
      );
    return {
      kind: 'FOUND',
      patient,
      ...(diagnosticRequestId ? { diagnosticRequestId } : {}),
    };
  }

  private async readErrorEnvelope(
    response: Response,
    diagnosticRequestId?: string,
  ): Promise<MtdomErrorEnvelope> {
    if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) {
      throw new MtdomPatientsReadError(
        'UNEXPECTED_ERROR_CONTENT_TYPE',
        false,
        undefined,
        diagnosticRequestId,
      );
    }
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new MtdomPatientsReadError(
        'INVALID_ERROR_RESPONSE',
        false,
        undefined,
        diagnosticRequestId,
      );
    }
    const parsed = parseErrorEnvelope(payload);
    if (!parsed)
      throw new MtdomPatientsReadError(
        'INVALID_ERROR_RESPONSE',
        false,
        undefined,
        diagnosticRequestId,
      );
    return parsed;
  }
}
