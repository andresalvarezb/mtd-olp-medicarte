import { ApiError, apiRequest } from './api-client';

export type MipresDirectionStatus = 'PENDING' | 'CONFIRMED' | 'QUERY_ERROR' | 'NOT_APPLICABLE';

export type MipresManualDecision =
  | 'PENDING_MANUAL_ENABLEMENT'
  | 'MANUALLY_ENABLED'
  | 'MANUALLY_DISABLED';

export type MipresDecisionAction = 'ENABLE' | 'DISABLE' | 'RESET';

export type MipresConceptAction = 'ENABLE' | 'DISABLE';

export type MipresManualUnlockMode =
  | 'NATURALLY_ENABLED'
  | 'PENDING_MANUAL_OVERRIDE'
  | 'NOT_ALLOWED';

export type MipresOperationalState = 'READY' | 'BLOCKED' | 'UNKNOWN';

export interface MipresDecisionConcept {
  code: string;
  name: string;
  action: MipresConceptAction;
  requiresObservation: boolean;
  active: boolean;
}

export interface MipresDirection {
  id: string | null;
  directionId: string | null;
  prescriptionNumber: string | null;
  technologyType: string | null;
  technologyConsecutive: string | null;
  maximumDeliveryDate: string | null;
  externalStatus: string | null;
  annulled: boolean | null;
  current: boolean | null;
}

export interface MipresLifecycleReason {
  code: string;
  message: string;
}

export interface MipresListItem {
  id: string;

  authorizationNumber: string;

  patientDocument: string | null;

  patientName: string | null;

  productDescription: string | null;

  productCode: string | null;

  commercialCode: string | null;

  quantity: string | null;

  prescriptionNumber: string | null;

  coverageType: string | null;

  directionStatus: MipresDirectionStatus;

  atStatus: string | null;

  manualDecision: MipresManualDecision;
  authorizationState: 'ENABLED' | 'PENDING' | 'DISABLED';

  initialValidationStatus:
    | 'PASSED'
    | 'PENDING'
    | 'FAILED';

  validityStatus:
    | 'IN_WINDOW'
    | 'EXPIRED'
    | 'OUTSIDE_HORIZON'
    | 'INVALID_DATE';

  lifecycleReasons:
    MipresLifecycleReason[];

  mipresState: 'LOCKED' | 'UNLOCKED';

  manualUnlockAllowed: boolean;

  manualUnlockMode: MipresManualUnlockMode;

  blockedReasons: string[];

  manualVersion: number;

  operationalState: MipresOperationalState;

  operationalEligible: boolean | null;

  assignmentDate: string | null;

  validityEndDate: string | null;

  updatedAt: string | null;
}

export interface MipresDetail extends MipresListItem {
  manualConceptCode: string | null;

  manualConceptName: string | null;

  manualObservation: string | null;

  manualUpdatedAt: string | null;

  manualUpdatedBy: string | null;

  currentDirection: MipresDirection | null;

  raw: Record<string, unknown>;
}

export interface MipresHistoryEvent {
  id: string;
  kind: 'MIPRES' | 'MTD';
  title: string;
  description: string | null;
  createdAt: string | null;
  actor: string | null;
  decisionVersion: number | null;
  raw: Record<string, unknown>;
}

export interface MipresListResponse {
  items: MipresListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MipresListFilters {
  search?: string;

  authorization?: string;

  patient?: string;
  directionStatus?: string;
  atStatus?: string;
  manualDecision?: string;
  state?: string;
  authorizationState?: 'ENABLED' | 'PENDING' | 'DISABLED';
  mipresState?: 'LOCKED' | 'UNLOCKED';
  page?: number;
  limit?: number;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUnknownArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function objectValue(value: unknown): JsonObject {
  return isObject(value) ? value : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();

    return trimmed ? trimmed : null;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return null;
}

function numberValue(value: unknown, fallback = 0): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return fallback;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true' || value === 'TRUE' || value === 1) {
    return true;
  }

  if (value === 'false' || value === 'FALSE' || value === 0) {
    return false;
  }

  return null;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const normalized = stringValue(item);

    return normalized ? [normalized] : [];
  });
}

function lifecycleReasonArray(
  value: unknown,
): MipresLifecycleReason[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const source =
      objectValue(item);

    const code =
      stringValue(
        source.code,
      );

    const message =
      stringValue(
        source.message,
      );

    return code && message
      ? [{ code, message }]
      : [];
  });
}

function firstString(source: JsonObject, keys: string[]): string | null {
  for (const key of keys) {
    const value = stringValue(source[key]);

    if (value !== null) {
      return value;
    }
  }

  return null;
}

function firstNumber(source: JsonObject, keys: string[], fallback = 0): number {
  for (const key of keys) {
    if (source[key] !== undefined) {
      return numberValue(source[key], fallback);
    }
  }

  return fallback;
}

function firstBoolean(source: JsonObject, keys: string[]): boolean | null {
  for (const key of keys) {
    if (source[key] !== undefined) {
      return booleanValue(source[key]);
    }
  }

  return null;
}

function sourceData(source: JsonObject): JsonObject {
  return objectValue(source.sourceData ?? source.source_data);
}

function sourceString(source: JsonObject, keys: string[]): string | null {
  const data = sourceData(source);

  return firstString(data, keys);
}

function normalizeDirectionStatus(value: unknown): MipresDirectionStatus {
  const status = stringValue(value);

  if (status === 'CONFIRMED' || status === 'QUERY_ERROR' || status === 'NOT_APPLICABLE') {
    return status;
  }

  return 'PENDING';
}

function normalizeManualDecision(value: unknown): MipresManualDecision {
  const decision = stringValue(value);

  if (decision === 'MANUALLY_ENABLED' || decision === 'MANUALLY_DISABLED') {
    return decision;
  }

  return 'PENDING_MANUAL_ENABLEMENT';
}

function normalizeOperationalState(source: JsonObject): MipresOperationalState {
  const eligible = firstBoolean(source, [
    'operationalEligible',
    'operational_eligible',
    'eligible',
    'isOperationallyEligible',
  ]);

  if (eligible === true) {
    return 'READY';
  }

  if (eligible === false) {
    return 'BLOCKED';
  }

  const raw = firstString(source, [
    'state',
    'operationalState',
    'operational_state',
    'operationalStatus',
  ]);

  if (raw === 'READY' || raw === 'READY_TO_DISPENSE' || raw === 'LISTA') {
    return 'READY';
  }

  if (raw === 'BLOCKED' || raw === 'BLOQUEADA' || raw === 'OUT_OF_OPERATION') {
    return 'BLOCKED';
  }

  return 'UNKNOWN';
}

function normalizeAt(source: JsonObject): string | null {
  const direct = firstString(source, ['atStatus', 'at', 'AT', 'atIncluded']);

  if (direct) {
    if (direct === 'true') {
      return 'INCLUDED';
    }

    if (direct === 'false') {
      return 'EXCLUDED';
    }

    return direct;
  }

  const data = sourceData(source);

  return firstString(data, ['AT', 'AMBITO_TUTELA', 'TUTELA', 'ES_AT']);
}

function normalizeListItem(value: unknown): MipresListItem {
  const source = objectValue(value);

  const id = firstString(source, ['id', 'authorizationItemId', 'authorization_item_id']) ?? '';

  const authorizationNumber =
    firstString(source, ['authorizationNumber', 'numeroAutorizacion', 'numero_autorizacion']) ??
    sourceString(source, ['NUMERO_AUTORIZACION', 'AUTORIZACION']) ??
    '—';

  const patientDocument =
    firstString(source, ['patientDocument', 'document', 'identificacionPaciente']) ??
    sourceString(source, ['IDENTIFICACION_PACIENTE', 'NUM_DOCUMENTO', 'DOCUMENTO']);

  const patientName =
    firstString(source, ['patientName', 'patient', 'nombrePaciente']) ??
    sourceString(source, ['NOMBRE_PACIENTE', 'PACIENTE']);

  const productDescription =
    firstString(source, ['productDescription', 'medicationName', 'productName', 'producto']) ??
    sourceString(source, ['DESCRIPCION_PRODUCTO', 'NOMBRE_MEDICAMENTO', 'PRODUCTO', 'MEDICAMENTO']);

  const productCode =
    firstString(source, [
      'productCode',
      'commercialCode',
      'codigoComercial',
      'codigoMedicamento',
    ]) ?? sourceString(source, ['CODIGO_COMERCIAL', 'CODIGO_MEDICAMENTO']);

  const quantity =
    firstString(source, ['quantity', 'cantidad']) ?? sourceString(source, ['CANTIDAD']);

  const prescriptionNumber =
    firstString(source, [
      'prescriptionNumber',
      'noPrescripcion',
      'prescription',
      'no_prescripcion',
    ]) ?? sourceString(source, ['NO_PRESCRIPCION', 'PRESCRIPCION']);

  const operationalEligible = firstBoolean(source, [
    'operationalEligible',
    'operational_eligible',
    'eligible',
  ]);

  const authorizationStateValue = firstString(source, [
    'authorizationState',
    'authorization_state',
  ]);

  if (
    authorizationStateValue !== 'ENABLED'
    &&
    authorizationStateValue !== 'PENDING'
    &&
    authorizationStateValue !== 'DISABLED'
  ) {
    throw new Error(
      `Invalid MIPRES authorizationState: ${String(
        authorizationStateValue,
      )}`,
    );
  }

  const authorizationState:
    MipresListItem['authorizationState'] =
      authorizationStateValue;

  const initialValidationStatusValue =
    firstString(
      source,
      [
        'initialValidationStatus',
        'initial_validation_status',
      ],
    );

  const initialValidationStatus:
    MipresListItem['initialValidationStatus'] =
      initialValidationStatusValue ===
        'PASSED'
        ? 'PASSED'
        : initialValidationStatusValue ===
            'FAILED'
          ? 'FAILED'
          : 'PENDING';

  const validityStatusValue =
    firstString(
      source,
      [
        'validityStatus',
        'validity_status',
      ],
    );

  const validityStatus:
    MipresListItem['validityStatus'] =
      validityStatusValue ===
        'IN_WINDOW'
        ? 'IN_WINDOW'
        : validityStatusValue ===
            'EXPIRED'
          ? 'EXPIRED'
          : validityStatusValue ===
              'OUTSIDE_HORIZON'
            ? 'OUTSIDE_HORIZON'
            : 'INVALID_DATE';

  const mipresStateValue = firstString(source, ['mipresState', 'mipres_state']);

  const mipresState: MipresListItem['mipresState'] =
    mipresStateValue === 'UNLOCKED' ? 'UNLOCKED' : 'LOCKED';

  return {
    id,

    authorizationNumber,

    patientDocument,

    patientName,

    productDescription,

    productCode,

    commercialCode: productCode,

    quantity,

    prescriptionNumber,

    authorizationState,

    initialValidationStatus,

    validityStatus,

    lifecycleReasons:
      lifecycleReasonArray(
        source.lifecycleReasons
        ??
        source.lifecycle_reasons,
      ),

    mipresState,

    manualUnlockAllowed:
      firstBoolean(source, ['manualUnlockAllowed', 'manual_unlock_allowed']) === true,

    manualUnlockMode: (() => {
      const value = firstString(source, ['manualUnlockMode', 'manual_unlock_mode']);

      if (value === 'NATURALLY_ENABLED' || value === 'PENDING_MANUAL_OVERRIDE') {
        return value;
      }

      return 'NOT_ALLOWED';
    })(),

    blockedReasons: stringArray(source.blockedReasons ?? source.blocked_reasons),

    coverageType: firstString(source, ['coverageType', 'coverage_type']),

    directionStatus: normalizeDirectionStatus(source.directionStatus ?? source.direction_status),

    atStatus: normalizeAt(source),

    manualDecision: normalizeManualDecision(
      source.manualDecision ??
        source.mipresManualDecision ??
        source.manual_decision ??
        source.mipres_manual_decision,
    ),

    manualVersion: firstNumber(
      source,
      [
        'manualVersion',
        'decisionVersion',
        'version',
        'mipresManualVersion',
        'mipres_manual_version',
      ],
      0,
    ),

    operationalState: normalizeOperationalState(source),

    operationalEligible,

    assignmentDate:
      firstString(source, ['assignmentDate', 'assignmentOn', 'authorizationAssignmentOn']) ??
      sourceString(source, ['FECHA_ASIGNACION']),

    validityEndDate:
      firstString(source, ['validityEndDate', 'expiresOn', 'authorizationExpiresOn']) ??
      sourceString(source, ['FECHA_FINAL_VIGENCIA']),

    updatedAt: firstString(source, ['updatedAt', 'updated_at']),
  };
}

function normalizeDirection(value: unknown): MipresDirection | null {
  if (!isObject(value)) {
    return null;
  }

  return {
    id: firstString(value, ['id', 'externalId']),

    directionId: firstString(value, [
      'directionId',
      'direccionamientoId',
      'externalDirectionId',
      'direction_id',
    ]),

    prescriptionNumber: firstString(value, [
      'prescriptionNumber',
      'noPrescripcion',
      'prescription_number',
    ]),

    technologyType: firstString(value, ['technologyType', 'tipoTec', 'technology_type']),

    technologyConsecutive: firstString(value, [
      'technologyConsecutive',
      'conTec',
      'technology_consecutive',
    ]),

    maximumDeliveryDate: firstString(value, [
      'maximumDeliveryDate',
      'maxDeliveryDate',
      'maximum_delivery_date',
    ]),

    externalStatus: firstString(value, ['externalStatus', 'status', 'external_status']),

    annulled: firstBoolean(value, ['annulled', 'isAnnulled']),

    current: firstBoolean(value, ['current', 'isCurrent']),
  };
}

function findCurrentDirection(source: JsonObject): MipresDirection | null {
  const direct = source.currentDirection ?? source.direction ?? source.mipresDirection;

  const normalized = normalizeDirection(direct);

  if (normalized) {
    return normalized;
  }

  const directions = isUnknownArray(source.directions)
    ? source.directions
    : isUnknownArray(source.mipresDirections)
      ? source.mipresDirections
      : [];

  const current =
    directions.find(
      (item) => isObject(item) && (item.current === true || item.isCurrent === true),
    ) ?? directions[0];

  return normalizeDirection(current);
}

function normalizeDetail(value: unknown): MipresDetail {
  const source = objectValue(value);

  const base = normalizeListItem(source);

  const decision = objectValue(
    source.manualDecisionDetail ?? source.decision ?? source.mtdDecision,
  );

  return {
    ...base,

    manualConceptCode:
      firstString(source, [
        'manualConceptCode',
        'conceptCode',
        'mipresManualConceptCode',
        'mipres_manual_concept_code',
      ]) ?? firstString(decision, ['conceptCode', 'code']),

    manualConceptName:
      firstString(source, ['manualConceptName', 'conceptName']) ??
      firstString(decision, ['conceptName', 'name']),

    manualObservation:
      firstString(source, [
        'manualObservation',
        'observation',
        'manualNote',
        'note',
        'mipresManualNote',
        'mipres_manual_note',
      ]) ?? firstString(decision, ['observation', 'note']),

    manualUpdatedAt:
      firstString(source, [
        'manualUpdatedAt',
        'mipresManualUpdatedAt',
        'mipres_manual_updated_at',
      ]) ?? firstString(decision, ['updatedAt', 'createdAt']),

    manualUpdatedBy:
      firstString(source, [
        'manualUpdatedBy',
        'mipresManualUpdatedBy',
        'mipres_manual_updated_by',
      ]) ?? firstString(decision, ['actor', 'actorName', 'updatedBy']),

    currentDirection: findCurrentDirection(source),

    raw: source,
  };
}

function eventDate(source: JsonObject): string | null {
  return firstString(source, [
    'createdAt',
    'queriedAt',
    'updatedAt',
    'decidedAt',
    'timestamp',
    'created_at',
    'queried_at',
  ]);
}

function normalizeEvidenceEvent(value: unknown, index: number): MipresHistoryEvent {
  const source = objectValue(value);

  const direction = firstString(source, ['directionStatus', 'outcome', 'status']);

  const queryType = firstString(source, ['queryType', 'query_type']);

  return {
    id: firstString(source, ['id']) ?? `evidence-${index}`,

    kind: 'MIPRES',

    title: direction ? `MIPRES · ${direction}` : 'Consulta MIPRES',

    description: queryType ? `Consulta ${queryType === 'MANUAL' ? 'manual' : 'automática'}` : null,

    createdAt: eventDate(source),

    actor: null,

    decisionVersion: null,

    raw: source,
  };
}

function decisionLabel(value: string | null): string {
  if (value === 'MANUALLY_ENABLED') {
    return 'Habilitada manualmente';
  }

  if (value === 'MANUALLY_DISABLED') {
    return 'Inhabilitada manualmente';
  }

  return 'Pendiente por habilitar manualmente';
}

function normalizeDecisionEvent(value: unknown, index: number): MipresHistoryEvent {
  const source = objectValue(value);

  const decision = firstString(source, ['decision', 'manualDecision']);

  const concept = firstString(source, ['conceptName', 'conceptCode', 'concept']);

  const observation = firstString(source, ['observation', 'note']);

  return {
    id: firstString(source, ['id']) ?? `decision-${index}`,

    kind: 'MTD',

    title: `Decisión MTD · ${decisionLabel(decision)}`,

    description: [concept, observation].filter(Boolean).join(' · ') || null,

    createdAt: eventDate(source),

    actor: firstString(source, ['actorName', 'actor', 'updatedBy', 'username']),

    decisionVersion:
      source.decisionVersion !== undefined ? numberValue(source.decisionVersion) : null,

    raw: source,
  };
}

function historyArrays(value: unknown): {
  evidence: unknown[];
  decisions: unknown[];
} {
  if (Array.isArray(value)) {
    const evidence: unknown[] = [];

    const decisions: unknown[] = [];

    for (const item of value) {
      const source = objectValue(item);

      if (source.decision !== undefined || source.decisionVersion !== undefined) {
        decisions.push(item);
      } else {
        evidence.push(item);
      }
    }

    return {
      evidence,
      decisions,
    };
  }

  const source = objectValue(value);

  const evidence = Array.isArray(source.evidenceEvents)
    ? source.evidenceEvents
    : Array.isArray(source.mipresEvents)
      ? source.mipresEvents
      : Array.isArray(source.checks)
        ? source.checks
        : [];

  const decisions = Array.isArray(source.decisionEvents)
    ? source.decisionEvents
    : Array.isArray(source.decisions)
      ? source.decisions
      : Array.isArray(source.manualDecisionEvents)
        ? source.manualDecisionEvents
        : [];

  return {
    evidence,
    decisions,
  };
}

function normalizeHistory(value: unknown): MipresHistoryEvent[] {
  const arrays = historyArrays(value);

  const events = [
    ...arrays.evidence.map(normalizeEvidenceEvent),

    ...arrays.decisions.map(normalizeDecisionEvent),
  ];

  return events.sort((left, right) => {
    const leftTime = left.createdAt ? Date.parse(left.createdAt) : 0;

    const rightTime = right.createdAt ? Date.parse(right.createdAt) : 0;

    return rightTime - leftTime;
  });
}

function normalizeConcept(value: unknown): MipresDecisionConcept | null {
  const source = objectValue(value);

  const code = firstString(source, ['code']);

  const name = firstString(source, ['name', 'label']);

  const action = firstString(source, ['action']);

  if (!code || !name || (action !== 'ENABLE' && action !== 'DISABLE')) {
    return null;
  }

  return {
    code,

    name,

    action,

    requiresObservation:
      firstBoolean(source, ['requiresObservation', 'requiresNote', 'requires_note']) ?? false,

    active: firstBoolean(source, ['active']) ?? true,
  };
}

function queryString(filters: MipresListFilters): string {
  const params = new URLSearchParams();

  if (filters.authorization) {
    params.set('authorization', filters.authorization);
  }

  if (filters.patient) {
    params.set('patient', filters.patient);
  }

  if (filters.search) {
    params.set('search', filters.search);
  }

  if (filters.directionStatus) {
    params.set('directionStatus', filters.directionStatus);
  }

  if (filters.atStatus) {
    params.set('atStatus', filters.atStatus);
  }

  if (filters.manualDecision) {
    params.set('manualDecision', filters.manualDecision);
  }

  if (filters.state) {
    params.set('state', filters.state);
  }

  if (filters.authorizationState) {
    params.set('authorizationState', filters.authorizationState);
  }

  if (filters.mipresState) {
    params.set('mipresState', filters.mipresState);
  }

  params.set('page', String(filters.page ?? 1));

  params.set('limit', String(filters.limit ?? 25));

  return params.toString();
}

export async function listMipres(
  organizationId: string,
  filters: MipresListFilters,
  signal?: AbortSignal,
): Promise<MipresListResponse> {
  const query = queryString(filters);

  const response = await apiRequest<unknown>(`/mipres?${query}`, {
    organizationId,
    signal,
  });

  const source = objectValue(response);

  const rawItems = Array.isArray(source.items)
    ? source.items
    : Array.isArray(source.data)
      ? source.data
      : Array.isArray(response)
        ? response
        : [];

  const items = rawItems.map(normalizeListItem).filter((item) => Boolean(item.id));

  return {
    items,

    total: firstNumber(source, ['total', 'count', 'totalItems'], items.length),

    page: firstNumber(source, ['page'], filters.page ?? 1),

    pageSize: firstNumber(source, ['pageSize', 'limit'], filters.limit ?? 25),
  };
}

export async function getMipresDetail(
  id: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<MipresDetail> {
  const response = await apiRequest<unknown>(`/mipres/${id}`, {
    organizationId,
    signal,
  });

  return normalizeDetail(response);
}

export async function getMipresHistory(
  id: string,
  organizationId: string,
  signal?: AbortSignal,
): Promise<MipresHistoryEvent[]> {
  const response = await apiRequest<unknown>(`/mipres/${id}/history`, {
    organizationId,
    signal,
  });

  return normalizeHistory(response);
}

export async function getMipresConcepts(
  organizationId: string,
  signal?: AbortSignal,
): Promise<MipresDecisionConcept[]> {
  const response = await apiRequest<unknown>('/mipres/decision-concepts', {
    organizationId,
    signal,
  });

  const source = objectValue(response);

  const raw = Array.isArray(response)
    ? response
    : Array.isArray(source.items)
      ? source.items
      : Array.isArray(source.concepts)
        ? source.concepts
        : [];

  return raw
    .map(normalizeConcept)
    .filter((item): item is MipresDecisionConcept => item !== null && item.active);
}

export async function submitMipresDecision(input: {
  id: string;
  organizationId: string;
  action: MipresDecisionAction;
  expectedVersion: number;
  conceptCode?: string;
  observation?: string;
}): Promise<unknown> {
  const body: Record<string, unknown> = {
    action: input.action,

    expectedVersion: input.expectedVersion,
  };

  if (input.conceptCode) {
    body.conceptCode = input.conceptCode;
  }

  if (input.observation) {
    body.observation = input.observation;
  }

  return apiRequest<unknown>(`/mipres/${input.id}/decision`, {
    method: 'POST',

    organizationId: input.organizationId,

    idempotencyKey: crypto.randomUUID(),

    body: JSON.stringify(body),
  });
}

export async function recheckMipres(id: string, organizationId: string): Promise<unknown> {
  return apiRequest<unknown>(`/mipres/${id}/recheck`, {
    method: 'POST',

    organizationId,

    idempotencyKey: crypto.randomUUID(),

    body: '{}',
  });
}

export function mipresErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return 'La autorización cambió mientras estaba abierta. Se actualizaron los datos; revisa la decisión actual antes de intentar nuevamente.';
    }

    if (error.status === 429) {
      return 'Se alcanzó el límite diario de reconsultas manuales MIPRES para esta autorización.';
    }

    if (error.status === 403) {
      return 'Tu usuario no tiene permiso para ejecutar esta operación.';
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'No fue posible completar la operación.';
}
