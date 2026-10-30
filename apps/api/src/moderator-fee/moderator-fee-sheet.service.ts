import {
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';

import type { ApiConfig } from '@authorization/config';

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { google, type sheets_v4 } from 'googleapis';

import { API_CONFIG } from '../tokens';

export type ModeratorFeeSheetRow = {
  /** UUID de la autorización */
  authorizationItemId: string;

  /** Número de autorización (ej: AUT-PRUEBA-0001) */
  authorizationNumber: string | null;

  /** Documento del paciente (IDENTIFICACION_PACIENTE) */
  patientDocument: string | null;

  /** Tipo de documento del paciente (CC, TI, CE, RC, etc.) */
  patientDocumentType: string | null;

  /** Nombre del paciente */
  patientName: string | null;

  /** Fecha efectiva (historial-entrega registrada) */
  effectiveDate: string | null;

  /** Cédula del profesional ingresada en la interfaz */
  professionalDocument: string | null;

  /** Valor cuota moderadora esperado (COP) */
  expectedAmountCop: string | null;

  /** Valor recaudado (COP) */
  amountCop: string | null;

  /** Estado registrado: COLLECTED | NOT_COLLECTED */
  status: 'COLLECTED' | 'NOT_COLLECTED';

  /** Observación libre */
  observation: string | null;

  /** Timestamp en que se registró el evento (ISO) */
  registeredAt: string;

  /** ID del usuario que registró */
  registeredBy: string;
};

const DEFAULT_SHEET_NAME = 'PRUEBAS';

export const CANONICAL_HEADERS = [
  'ADMISION',
  'Identificacion_Afiliado',
  'CONVENIO',
  'Prefijo de admisión*',
  'Autorización',
  'AUTORIZACION DESDE',
  'AUTORIZACION HASTA',
  'CATEGORIA',
  'CENTRO COSTOS',
  'Cobertura o plan de beneficios',
  'Codigo_Diagnostico',
  'SERVICIO',
  'CANTIDAD',
  'PROFESIONAL',
  'OBSERVACION',
  'CopagoVALOR',
  'PREFIJO FRA',
  'Fecha inicio Facturación',
  'Fecha fin Facturación',
  'Tipo_Documento',
  'Forma de pago',
  'Clase*',
  'Tipo de empresa*',
  'Régimen fiscal*',
  'Responsabilidad fiscal DIAN*',
  'FACTURA',
  'ESTADO',
  'Código Formulario',
];

/**
 * Mapeo de tipo de documento a sigla:
 * 1 -> CC, 3 -> TI, 4 -> CE, 7 -> RC
 * Si ya viene como sigla (CC, TI, CE, RC), se conserva.
 */
function mapDocumentType(docType: string | null | undefined): string {
  if (!docType) return '';
  const normalized = docType.trim().toUpperCase();
  const map: Record<string, string> = {
    '1': 'CC',
    '3': 'TI',
    '4': 'CE',
    '7': 'RC',
    CC: 'CC',
    TI: 'TI',
    CE: 'CE',
    RC: 'RC',
  };
  return map[normalized] ?? normalized;
}

/**
 * Agrega el número de autorización con un punto al final:
 * "NUMERO_AUTORIZACION + ."
 */
function formatAuthorizationNumber(num: string | null | undefined): string {
  if (!num) return '';
  const trimmed = num.trim();
  return trimmed.endsWith('.') ? trimmed : `${trimmed}.`;
}

/**
 * Fechas calculadas en la zona horaria de Colombia (America/Bogota):
 * - primer día del mes actual (YYYY-MM-01)
 * - fecha actual (YYYY-MM-DD)
 */
function getBogotaDates(now = new Date()): { firstDayOfMonth: string; today: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now); // Formato "YYYY-MM-DD"

  const [year, month, day] = parts.split('-');
  return {
    firstDayOfMonth: `${year}-${month}-01`,
    today: `${year}-${month}-${day}`,
  };
}

function formatEffectiveDate(dateStr: string | null | undefined, fallback: string): string {
  if (!dateStr) return fallback;
  const trimmed = dateStr.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  try {
    return new Date(trimmed).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  } catch {
    return fallback;
  }
}

/**
 * Construye la fila de valores alineada con las columnas del Sheet.
 */
export function buildRowValues(headers: string[], data: ModeratorFeeSheetRow): string[] {
  const { firstDayOfMonth, today } = getBogotaDates();
  const effectiveDate = formatEffectiveDate(data.effectiveDate, today);

  const fieldMap: Record<string, string> = {
    'ADMISION': 'SERVICIOS',
    'Identificacion_Afiliado': data.patientDocument ?? '',
    'CONVENIO': 'CUOTMODNUT',
    'Prefijo de admisión*': 'AU-AUTORIZACION',
    'Autorización': formatAuthorizationNumber(data.authorizationNumber),
    'AUTORIZACION DESDE': effectiveDate,
    'AUTORIZACION HASTA': effectiveDate,
    'CATEGORIA': '1.MTD',
    'CENTRO COSTOS': 'BOGOTA',
    'Cobertura o plan de beneficios': '15.PARTICULAR',
    'Codigo_Diagnostico': 'CDGN001',
    'SERVICIO': '1RECCUOTMOD',
    'CANTIDAD': '1',
    'PROFESIONAL': data.professionalDocument?.trim() ?? '',
    'OBSERVACION': 'RECAUDO CUOTA MODERADORA ALTO COSTO',
    'CopagoVALOR': data.amountCop ?? data.expectedAmountCop ?? '',
    'PREFIJO FRA': 'MT',
    'Fecha inicio Facturación': firstDayOfMonth,
    'Fecha fin Facturación': today,
    'Tipo_Documento': mapDocumentType(data.patientDocumentType),
    'Forma de pago': '1.CREDITO',
    'Clase*': '2-PERSONA NATURAL',
    'Tipo de empresa*': '4-PERSONA NATURAL',
    'Régimen fiscal*': '05-REGIMEN ORDINARIO',
    'Responsabilidad fiscal DIAN*': 'R99-PN-NO RESPONSABLE',
    'FACTURA': '',
    'ESTADO': '',
    'Código Formulario': '',
  };

  const targetHeaders = headers.length > 0 ? headers : CANONICAL_HEADERS;
  return targetHeaders.map((h) => fieldMap[h.trim()] ?? '');
}

@Injectable()
export class ModeratorFeeSheetService {
  private readonly logger = new Logger(ModeratorFeeSheetService.name);

  constructor(
    @Inject(API_CONFIG)
    private readonly config: ApiConfig,
  ) {}

  /**
   * Escribe una fila en el Google Sheet configurado.
   *
   * Falla silenciosamente si el Sheet no está configurado
   * o si ocurre un error de red / permisos, para no
   * interrumpir el flujo principal de registro de recaudo.
   */
  private getCredentialPath(): string | null {
    let credentialFile = this.config.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE;

    if (credentialFile && !existsSync(credentialFile)) {
      const resolved = resolve(process.cwd(), credentialFile);
      if (existsSync(resolved)) {
        credentialFile = resolved;
      }
    }

    if (!credentialFile || !existsSync(credentialFile)) {
      const fallback = resolve(process.cwd(), 'secrets/google-service-account.json');
      if (existsSync(fallback)) {
        credentialFile = fallback;
      }
    }

    return credentialFile && existsSync(credentialFile) ? credentialFile : null;
  }

  /**
   * Obtiene la URL de la factura desde la columna "Print factura"
   * en la fila correspondiente a la autorización.
   *
   * Retorna null si la fila no existe, si la columna aún no está llena
   * con una URL válida, o si no está configurada la integración de Sheets.
   */
  async getInvoiceUrl(authorizationNumber: string | null): Promise<string | null> {
    if (!authorizationNumber?.trim()) {
      return null;
    }

    const spreadsheetId = this.config.GOOGLE_SHEETS_MODERATOR_FEE_ID;
    const credentialFile = this.getCredentialPath();

    if (!spreadsheetId || !credentialFile) {
      return null;
    }

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
      });

      const sheets = google.sheets({ version: 'v4', auth });
      const sheetName =
        this.config.GOOGLE_SHEETS_MODERATOR_FEE_SHEET_NAME || DEFAULT_SHEET_NAME;

      const res = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName}'!A1:AZ`,
      });

      const rows = res.data.values as unknown[][] | null | undefined;
      if (!rows || rows.length < 2) {
        return null;
      }

      const headers = (rows[0] ?? []).map((value) =>
        typeof value === 'string' ? value : '',
      );
      const authColIdx = headers.findIndex((h) => {
        if (!h) return false;
        const norm = h.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        return norm === 'autorizacion';
      });

      const printColIdx = headers.findIndex((h) => {
        if (!h) return false;
        const norm = h.trim().toLowerCase();
        return norm === 'print factura';
      });

      if (authColIdx === -1 || printColIdx === -1) {
        this.logger.warn(
          `Columnas no encontradas en hoja ${sheetName}: Autorización (${authColIdx}), Print factura (${printColIdx})`,
        );
        return null;
      }

      const targetAuth = authorizationNumber.trim().replace(/\.+$/, '').toLowerCase();

      // Buscar de abajo hacia arriba (fila más reciente)
      for (let i = rows.length - 1; i >= 1; i--) {
        const row = rows[i];
        if (!row) continue;
        const authorizationCell = row[authColIdx];
        const rowAuth =
          typeof authorizationCell === 'string'
            ? authorizationCell.trim().replace(/\.+$/, '').toLowerCase()
            : typeof authorizationCell === 'number'
              ? String(authorizationCell).toLowerCase()
              : '';
        if (rowAuth === targetAuth) {
          const urlCell = row[printColIdx];
          const rawUrl = typeof urlCell === 'string' ? urlCell.trim() : '';
          if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
            return rawUrl;
          }
          return null;
        }
      }

      return null;
    } catch (cause: unknown) {
      this.logger.warn(
        `Error al consultar URL de factura en Sheet para ${authorizationNumber}: ${
          cause instanceof Error ? cause.message : String(cause)
        }`,
      );
      return null;
    }
  }

  /**
   * Escribe una fila en el Google Sheet configurado.
   *
   * Falla silenciosamente si el Sheet no está configurado
   * o si ocurre un error de red / permisos, para no
   * interrumpir el flujo principal de registro de recaudo.
   */
  async appendRow(data: ModeratorFeeSheetRow): Promise<void> {
    const spreadsheetId = this.config.GOOGLE_SHEETS_MODERATOR_FEE_ID;
    const credentialFile = this.getCredentialPath();

    if (!spreadsheetId || !credentialFile) {
      this.logger.warn(
        'Google Sheets para cuota moderadora no configurado. ' +
        'Define GOOGLE_SHEETS_MODERATOR_FEE_ID y GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE.',
      );
      return;
    }

    try {
      const auth = new google.auth.GoogleAuth({
        keyFile: credentialFile,
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      });

      const sheets = google.sheets({ version: 'v4', auth });

      const sheetName =
        this.config.GOOGLE_SHEETS_MODERATOR_FEE_SHEET_NAME || DEFAULT_SHEET_NAME;

      // 1. Asegurar que existe la hoja y obtener los encabezados actuales
      const headers = await this.ensureHeaderRow(sheets, spreadsheetId, sheetName);

      // 2. Construir la fila alineada a las columnas de la hoja
      const values = buildRowValues(headers, data);

      // 3. Agregar la fila con los datos del recaudo
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `${sheetName}!A:AB`,
        valueInputOption: 'USER_ENTERED',
        requestBody: {
          values: [values],
        },
      });

      this.logger.log(
        `Recaudo cuota moderadora registrado en Sheet (${sheetName}): ${data.authorizationItemId} - Autorización: ${data.authorizationNumber}`,
      );
    } catch (cause: unknown) {
      // No lanzar el error — el recaudo ya fue guardado en BD.
      this.logger.error(
        'No fue posible registrar el recaudo en Google Sheets.',
        cause instanceof Error ? cause.stack : String(cause),
      );
    }
  }

  /**
   * Crea la hoja con encabezados si no existe todavía.
   * Devuelve los encabezados encontrados o los canónicos si estaban vacíos.
   */
  private async ensureHeaderRow(
    sheets: ReturnType<typeof google.sheets>,
    spreadsheetId: string,
    sheetName: string,
  ): Promise<string[]> {
    try {
      const meta = await sheets.spreadsheets.get({ spreadsheetId });
      const sheetNames = (meta.data.sheets ?? []).map(
        (s: sheets_v4.Schema$Sheet) => s.properties?.title,
      );

      if (!sheetNames.includes(sheetName)) {
        // Crear hoja nueva
        await sheets.spreadsheets.batchUpdate({
          spreadsheetId,
          requestBody: {
            requests: [
              {
                addSheet: {
                  properties: { title: sheetName },
                },
              },
            ],
          },
        });
      }

      // Verificar si la primera fila ya tiene encabezados
      const check = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `${sheetName}!1:1`,
      });

      const firstRow = check.data.values?.[0] as string[] | undefined;

      if (!firstRow || firstRow.length === 0 || !firstRow[0]) {
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: `${sheetName}!A1`,
          valueInputOption: 'RAW',
          requestBody: { values: [CANONICAL_HEADERS] },
        });
        return CANONICAL_HEADERS;
      }

      return firstRow;
    } catch (cause: unknown) {
      this.logger.warn(
        'No fue posible verificar/crear encabezados en la hoja.',
        cause instanceof Error ? cause.stack : String(cause),
      );
      return CANONICAL_HEADERS;
    }
  }
}
