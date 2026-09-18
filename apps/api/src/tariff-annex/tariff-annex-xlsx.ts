import * as XLSX from 'xlsx';

export type TariffCommercialSnapshot = Readonly<{
  codigoProducto: string;
  tarifaUnidadRaw: string | null;
  tarifaUnidadCanonical: string | null;
  numeroExpedienteInvima: string | null;
  consecutivoInvimaPresentacion: string | null;
  descripcionGenerica: string | null;
  descripcionComercial: string | null;
  laboratorio: string | null;
  tipoInclusion: string | null;
}>;

export type ActiveTariffProduct = TariffCommercialSnapshot &
  Readonly<{
    id: string;
    version: number;
    active: boolean;
  }>;

export type TariffPreviewAction = 'NEW' | 'UNCHANGED' | 'UPDATE' | 'REJECT';
export type TariffPreviewState = 'UNCHANGED' | 'CHANGED' | 'ANOMALOUS' | 'REJECTED';

export type TariffPreviewRow = Readonly<{
  rowNumber: number;
  codigoProducto: string | null;
  state: TariffPreviewState;
  action: TariffPreviewAction;
  anomalyCode: string | null;
  rawData: Record<string, unknown>;
  next: TariffCommercialSnapshot | null;
  previous: ActiveTariffProduct | null;
}>;

export type TariffPreview = Readonly<{
  total: number;
  unchanged: number;
  changed: number;
  anomalous: number;
  rejected: number;
  scalePatternDetected: boolean;
  rows: readonly TariffPreviewRow[];
}>;

const REQUIRED_CODE_HEADERS = ['CODIGO_PRODUCTO', 'COD_COMERCIAL', 'CODIGO_COMERCIAL'] as const;

const FIELD_HEADERS = {
  tarifaUnidad: ['TARIFA_UNIDAD'],
  numeroExpedienteInvima: ['NUMERO_EXPEDIENTE_INVIMA', 'EXPEDIENTE_INVIMA'],
  consecutivoInvimaPresentacion: [
    'CONSECUTIVO_INVIMA_PRESENTACION',
    'CONSECUTIVO_PRESENTACION_INVIMA',
  ],
  descripcionGenerica: ['DESCRIPCION_GENERICA', 'DESCRIPCION_GENERICA_MEDICAMENTO'],
  descripcionComercial: ['DESCRIPCION_COMERCIAL', 'DESCRIPCION_COMERCIAL_MEDICAMENTO'],
  laboratorio: ['LABORATORIO', 'LABORATORIO_MEDICAMENTO'],
  tipoInclusion: ['TIPO_INCLUSION_MEDICAMENTO', 'TIPO_INCLUSION'],
} as const;

export function normalizeTariffProductCode(value: unknown): string {
  return cellText(value).trim().toUpperCase();
}

export function canonicalTariffValue(value: unknown): string | null {
  const raw = cellText(value).trim();
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, '').replace(',', '.');

  if (!/^[+]?\d+(?:\.\d{1,4})?$/.test(normalized)) return null;

  const numeric = Number(normalized);
  if (!Number.isFinite(numeric) || numeric < 0) return null;

  return numeric.toFixed(4);
}

export function buildTariffPreview(input: {
  content: Buffer;
  activeProducts: readonly ActiveTariffProduct[];
}): TariffPreview {
  const workbook = XLSX.read(input.content, {
    type: 'buffer',
    raw: true,
  });

  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    throw new Error('TARIFF_IMPORT_NO_SHEET');
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error('TARIFF_IMPORT_NO_SHEET');
  }

  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
  });

  if (matrix.length === 0) {
    throw new Error('TARIFF_IMPORT_EMPTY_FILE');
  }

  const headers = (matrix[0] ?? []).map((value) => normalizeHeader(cellText(value)));

  const codeIndex = findHeader(headers, REQUIRED_CODE_HEADERS);
  if (codeIndex === -1) {
    throw new Error('TARIFF_IMPORT_PRODUCT_CODE_HEADER_REQUIRED');
  }

  const indexes = {
    tarifaUnidad: findHeader(headers, FIELD_HEADERS.tarifaUnidad),
    numeroExpedienteInvima: findHeader(headers, FIELD_HEADERS.numeroExpedienteInvima),
    consecutivoInvimaPresentacion: findHeader(headers, FIELD_HEADERS.consecutivoInvimaPresentacion),
    descripcionGenerica: findHeader(headers, FIELD_HEADERS.descripcionGenerica),
    descripcionComercial: findHeader(headers, FIELD_HEADERS.descripcionComercial),
    laboratorio: findHeader(headers, FIELD_HEADERS.laboratorio),
    tipoInclusion: findHeader(headers, FIELD_HEADERS.tipoInclusion),
  };

  const activeByCode = new Map(
    input.activeProducts
      .filter((product) => product.active)
      .map((product) => [normalizeTariffProductCode(product.codigoProducto), product]),
  );

  const seenCodes = new Set<string>();
  const rows: TariffPreviewRow[] = [];

  for (let index = 1; index < matrix.length; index += 1) {
    const values = matrix[index] ?? [];

    if (isBlankRow(values)) continue;

    const rowNumber = index + 1;
    const rawData = Object.fromEntries(
      headers.map((header, columnIndex) => [
        header || `COLUMN_${columnIndex + 1}`,
        values[columnIndex] ?? null,
      ]),
    );

    const codigoProducto = normalizeTariffProductCode(values[codeIndex]);

    if (!codigoProducto) {
      rows.push({
        rowNumber,
        codigoProducto: null,
        state: 'REJECTED',
        action: 'REJECT',
        anomalyCode: null,
        rawData,
        next: null,
        previous: null,
      });
      continue;
    }

    if (seenCodes.has(codigoProducto)) {
      rows.push({
        rowNumber,
        codigoProducto,
        state: 'REJECTED',
        action: 'REJECT',
        anomalyCode: 'DUPLICATE_PRODUCT_IN_FILE',
        rawData,
        next: null,
        previous: activeByCode.get(codigoProducto) ?? null,
      });
      continue;
    }

    seenCodes.add(codigoProducto);

    const tarifaUnidadRaw = valueAt(values, indexes.tarifaUnidad);
    const tarifaUnidadCanonical =
      indexes.tarifaUnidad === -1 ? null : canonicalTariffValue(tarifaUnidadRaw);

    if (
      indexes.tarifaUnidad !== -1 &&
      cellText(tarifaUnidadRaw).trim() !== '' &&
      tarifaUnidadCanonical === null
    ) {
      rows.push({
        rowNumber,
        codigoProducto,
        state: 'REJECTED',
        action: 'REJECT',
        anomalyCode: 'INVALID_TARIFF_VALUE',
        rawData,
        next: null,
        previous: activeByCode.get(codigoProducto) ?? null,
      });
      continue;
    }

    const next: TariffCommercialSnapshot = {
      codigoProducto,
      tarifaUnidadRaw: nullableText(tarifaUnidadRaw),
      tarifaUnidadCanonical,
      numeroExpedienteInvima: nullableText(valueAt(values, indexes.numeroExpedienteInvima)),
      consecutivoInvimaPresentacion: nullableText(
        valueAt(values, indexes.consecutivoInvimaPresentacion),
      ),
      descripcionGenerica: nullableText(valueAt(values, indexes.descripcionGenerica)),
      descripcionComercial: nullableText(valueAt(values, indexes.descripcionComercial)),
      laboratorio: nullableText(valueAt(values, indexes.laboratorio)),
      tipoInclusion: nullableText(valueAt(values, indexes.tipoInclusion)),
    };

    const previous = activeByCode.get(codigoProducto) ?? null;

    if (!previous) {
      rows.push({
        rowNumber,
        codigoProducto,
        state: 'CHANGED',
        action: 'NEW',
        anomalyCode: null,
        rawData,
        next,
        previous: null,
      });
      continue;
    }

    const anomalyCode = detectTariffAnomaly(previous.tarifaUnidadCanonical, tarifaUnidadCanonical);

    if (anomalyCode) {
      rows.push({
        rowNumber,
        codigoProducto,
        state: 'ANOMALOUS',
        action: 'UPDATE',
        anomalyCode,
        rawData,
        next,
        previous,
      });
      continue;
    }

    if (commerciallyEqual(previous, next)) {
      rows.push({
        rowNumber,
        codigoProducto,
        state: 'UNCHANGED',
        action: 'UNCHANGED',
        anomalyCode: null,
        rawData,
        next,
        previous,
      });
      continue;
    }

    rows.push({
      rowNumber,
      codigoProducto,
      state: 'CHANGED',
      action: 'UPDATE',
      anomalyCode: null,
      rawData,
      next,
      previous,
    });
  }

  const anomalous = rows.filter((row) => row.state === 'ANOMALOUS').length;

  return {
    total: rows.length,
    unchanged: rows.filter((row) => row.state === 'UNCHANGED').length,
    changed: rows.filter((row) => row.state === 'CHANGED').length,
    anomalous,
    rejected: rows.filter((row) => row.state === 'REJECTED').length,
    scalePatternDetected: anomalous >= 2,
    rows,
  };
}

export function commerciallyEqual(
  previous: ActiveTariffProduct,
  next: TariffCommercialSnapshot,
): boolean {
  return (
    normalizeTariffProductCode(previous.codigoProducto) ===
      normalizeTariffProductCode(next.codigoProducto) &&
    normalizeCanonical(previous.tarifaUnidadCanonical) ===
      normalizeCanonical(next.tarifaUnidadCanonical) &&
    normalizeText(previous.numeroExpedienteInvima) === normalizeText(next.numeroExpedienteInvima) &&
    normalizeText(previous.consecutivoInvimaPresentacion) ===
      normalizeText(next.consecutivoInvimaPresentacion) &&
    normalizeText(previous.descripcionGenerica) === normalizeText(next.descripcionGenerica) &&
    normalizeText(previous.descripcionComercial) === normalizeText(next.descripcionComercial) &&
    normalizeText(previous.laboratorio) === normalizeText(next.laboratorio) &&
    normalizeText(previous.tipoInclusion) === normalizeText(next.tipoInclusion)
  );
}

function detectTariffAnomaly(
  previousCanonical: string | null,
  nextCanonical: string | null,
): string | null {
  if (previousCanonical === null || nextCanonical === null) return null;

  const previous = Number(previousCanonical);
  const next = Number(nextCanonical);

  if (!Number.isFinite(previous) || !Number.isFinite(next) || previous <= 0 || next < 0) {
    return null;
  }

  const ratio = next / previous;

  if (ratio >= 900 && ratio <= 1100) return 'TARIFF_SCALE_X1000';
  if (ratio >= 0.0009 && ratio <= 0.0011) return 'TARIFF_SCALE_DIV1000';

  return null;
}

function normalizeCanonical(value: string | null): string | null {
  if (value === null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(4) : value.trim();
}

function normalizeText(value: string | null): string | null {
  const normalized = value?.trim() ?? '';
  return normalized === '' ? null : normalized;
}

function nullableText(value: unknown): string | null {
  const text = cellText(value).trim();
  return text === '' ? null : text;
}

function valueAt(values: readonly unknown[], index: number): unknown {
  return index === -1 ? null : values[index];
}

function isBlankRow(values: readonly unknown[]): boolean {
  return values.every((value) => cellText(value).trim() === '');
}

function normalizeHeader(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '_');
}

function findHeader(headers: readonly string[], candidates: readonly string[]): number {
  for (const candidate of candidates) {
    const index = headers.indexOf(candidate);
    if (index !== -1) return index;
  }

  return -1;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;

  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }

  return '';
}
