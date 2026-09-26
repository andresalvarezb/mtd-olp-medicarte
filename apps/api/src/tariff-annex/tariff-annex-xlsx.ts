import * as XLSX from 'xlsx';

import {
  normalizeDeliveryPointCode,
  normalizeInvimaComponent,
  parseCumProductIdentity,
} from '@authorization/domain';

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
  minimumQuantity: number;
}>;

export type ActiveTariffProduct =
  TariffCommercialSnapshot &
    Readonly<{
      id: string;
      version: number;
      active: boolean;
    }>;

export type ActiveDeliveryPointMapping =
  Readonly<{
    invimaRecord: string;
    invimaPresentation: string;
    cumCode: string;
    serviceModel: string | null;
    siteName: string;
    dispensingPointCode: string;
  }>;

export type TariffPreviewAction =
  | 'NEW'
  | 'UNCHANGED'
  | 'UPDATE'
  | 'REJECT';

export type TariffPreviewState =
  | 'UNCHANGED'
  | 'CHANGED'
  | 'ANOMALOUS'
  | 'REJECTED';

export type TariffPreviewRow =
  Readonly<{
    rowNumber: number;
    codigoProducto: string | null;
    state: TariffPreviewState;
    action: TariffPreviewAction;
    anomalyCode: string | null;

    tariffChanged: boolean;

    deliveryPointManaged: boolean;
    deliveryPointChanged: boolean;

    rawData:
      Record<string, unknown>;

    next:
      TariffCommercialSnapshot | null;

    previous:
      ActiveTariffProduct | null;
  }>;

export type TariffPreview =
  Readonly<{
    total: number;
    unchanged: number;
    changed: number;
    anomalous: number;
    rejected: number;

    scalePatternDetected:
      boolean;

    rows:
      readonly TariffPreviewRow[];
  }>;

const REQUIRED_CODE_HEADERS = [
  'CODIGO_MEDICAMENTO',
  'CODIGO_PRODUCTO',
  'COD_COMERCIAL',
  'CODIGO_COMERCIAL',
] as const;

const FIELD_HEADERS = {
  tarifaUnidad: [
    'TARIFA_UNIDAD',
  ],

  numeroExpedienteInvima: [
    'NUMERO_EXPEDIENTE_INVIMA',
    'EXPEDIENTE_INVIMA',
  ],

  consecutivoInvimaPresentacion: [
    'CONSECUTIVO_INVIMA_PRESENTACION',
    'CONSECUTIVO_PRESENTACION_INVIMA',
  ],

  descripcionGenerica: [
    'DESCRIPCION_GENERICA',
    'DESCRIPCION_GENERICA_MEDICAMENTO',
  ],

  descripcionComercial: [
    'DESCRIPCION_COMERCIAL',
    'DESCRIPCION_COMERCIAL_MEDICAMENTO',
  ],

  laboratorio: [
    'LABORATORIO',
    'LABORATORIO_MEDICAMENTO',
  ],

  tipoInclusion: [
    'TIPO_INCLUSION_MEDICAMENTO',
    'TIPO_INCLUSION',
  ],

  minimumQuantity: [
    'CANTIDAD_MINIMA',
    'MINIMUM_QUANTITY',
  ],

  codigoCumFinal: [
    'CODIGO_CUM_FINAL',
    'CODIGO_CUM',
  ],

  modelo: [
    'MODELO',
  ],

  puntoAplicacionPredeterminado: [
    'PUNTO_APLICACION_PREDETERMINADO',
    'SEDE_ENTREGA',
  ],
} as const;

export function normalizeTariffProductCode(
  value: unknown,
): string {
  return cellText(value)
    .trim()
    .toUpperCase();
}

export function parseMinimumQuantity(
  value: unknown,
): number | null {
  const raw =
    cellText(value).trim();

  if (
    !raw ||
    !/^\d+$/.test(raw)
  ) {
    return null;
  }

  const numeric =
    Number(raw);

  if (
    !Number.isSafeInteger(
      numeric,
    ) ||
    numeric <= 0
  ) {
    return null;
  }

  return numeric;
}

export function canonicalTariffValue(
  value: unknown,
): string | null {
  const raw =
    cellText(value).trim();

  if (!raw) {
    return null;
  }

  const normalized =
    raw
      .replace(/\s+/g, '')
      .replace(',', '.');

  if (
    !/^[+]?\d+(?:\.\d{1,4})?$/.test(
      normalized,
    )
  ) {
    return null;
  }

  const numeric =
    Number(normalized);

  if (
    !Number.isFinite(numeric) ||
    numeric < 0
  ) {
    return null;
  }

  return numeric.toFixed(4);
}

export function buildTariffPreview(
  input: {
    content: Buffer;

    activeProducts:
      readonly ActiveTariffProduct[];

    activeDeliveryPoints?:
      readonly ActiveDeliveryPointMapping[];
  },
): TariffPreview {
  const workbook =
    XLSX.read(
      input.content,
      {
        type: 'buffer',
        raw: true,
      },
    );

  const sheetName =
    workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error(
      'TARIFF_IMPORT_NO_SHEET',
    );
  }

  const sheet =
    workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error(
      'TARIFF_IMPORT_NO_SHEET',
    );
  }

  const matrix =
    XLSX.utils.sheet_to_json<
      unknown[]
    >(
      sheet,
      {
        header: 1,
        raw: true,
        defval: null,
      },
    );

  if (
    matrix.length === 0
  ) {
    throw new Error(
      'TARIFF_IMPORT_EMPTY_FILE',
    );
  }

  const headers =
    (matrix[0] ?? [])
      .map(
        (value) =>
          normalizeHeader(
            cellText(value),
          ),
      );

  const codeIndex =
    findHeader(
      headers,
      REQUIRED_CODE_HEADERS,
    );

  if (
    codeIndex === -1
  ) {
    throw new Error(
      'TARIFF_IMPORT_PRODUCT_CODE_HEADER_REQUIRED',
    );
  }

  const indexes = {
    tarifaUnidad:
      findHeader(
        headers,
        FIELD_HEADERS.tarifaUnidad,
      ),

    numeroExpedienteInvima:
      findHeader(
        headers,
        FIELD_HEADERS.numeroExpedienteInvima,
      ),

    consecutivoInvimaPresentacion:
      findHeader(
        headers,
        FIELD_HEADERS.consecutivoInvimaPresentacion,
      ),

    descripcionGenerica:
      findHeader(
        headers,
        FIELD_HEADERS.descripcionGenerica,
      ),

    descripcionComercial:
      findHeader(
        headers,
        FIELD_HEADERS.descripcionComercial,
      ),

    laboratorio:
      findHeader(
        headers,
        FIELD_HEADERS.laboratorio,
      ),

    tipoInclusion:
      findHeader(
        headers,
        FIELD_HEADERS.tipoInclusion,
      ),

    minimumQuantity:
      findHeader(
        headers,
        FIELD_HEADERS.minimumQuantity,
      ),

    codigoCumFinal:
      findHeader(
        headers,
        FIELD_HEADERS.codigoCumFinal,
      ),

    modelo:
      findHeader(
        headers,
        FIELD_HEADERS.modelo,
      ),

    puntoAplicacionPredeterminado:
      findHeader(
        headers,
        FIELD_HEADERS.puntoAplicacionPredeterminado,
      ),
  };

  /*
   * Compatibilidad:
   *
   * - Archivo histórico:
   *   no trae CUM ni punto.
   *
   * - Archivo unificado:
   *   si aparece cualquiera de las
   *   columnas de logística, se exige
   *   CUM + punto.
   */
  const deliveryPointManaged =
    indexes.codigoCumFinal !== -1 ||
    indexes.puntoAplicacionPredeterminado !== -1;

  const deliveryPointHeadersComplete =
    indexes.codigoCumFinal !== -1 &&
    indexes.puntoAplicacionPredeterminado !== -1;

  const activeByCode =
    new Map(
      input.activeProducts
        .filter(
          (product) =>
            product.active,
        )
        .map(
          (product) => [
            normalizeTariffProductCode(
              product.codigoProducto,
            ),
            product,
          ],
        ),
    );

  const activeMappingByIdentity =
    new Map(
      (
        input.activeDeliveryPoints ??
        []
      ).map(
        (mapping) => [
          mappingIdentity(
            mapping.invimaRecord,
            mapping.invimaPresentation,
          ),
          mapping,
        ],
      ),
    );

  const seenCodes =
    new Set<string>();

  const rows:
    TariffPreviewRow[] = [];

  for (
    let index = 1;
    index < matrix.length;
    index += 1
  ) {
    const values =
      matrix[index] ?? [];

    if (
      isBlankRow(values)
    ) {
      continue;
    }

    const rowNumber =
      index + 1;

    const rawData =
      Object.fromEntries(
        headers.map(
          (
            header,
            columnIndex,
          ) => [
            header ||
              `COLUMN_${
                columnIndex + 1
              }`,

            values[
              columnIndex
            ] ?? null,
          ],
        ),
      );

    const codigoProducto =
      normalizeTariffProductCode(
        values[codeIndex],
      );

    if (!codigoProducto) {
      rows.push(
        rejectedRow({
          rowNumber,
          codigoProducto: null,
          anomalyCode:
            'PRODUCT_CODE_REQUIRED',
          rawData,
          deliveryPointManaged,
          previous: null,
        }),
      );

      continue;
    }

    const previous =
      activeByCode.get(
        codigoProducto,
      ) ?? null;

    if (
      seenCodes.has(
        codigoProducto,
      )
    ) {
      rows.push(
        rejectedRow({
          rowNumber,
          codigoProducto,
          anomalyCode:
            'DUPLICATE_PRODUCT_IN_FILE',
          rawData,
          deliveryPointManaged,
          previous,
        }),
      );

      continue;
    }

    seenCodes.add(
      codigoProducto,
    );

    const tarifaUnidadRaw =
      valueAt(
        values,
        indexes.tarifaUnidad,
      );

    const tarifaUnidadCanonical =
      indexes.tarifaUnidad === -1
        ? null
        : canonicalTariffValue(
            tarifaUnidadRaw,
          );

    if (
      indexes.tarifaUnidad !== -1 &&
      cellText(
        tarifaUnidadRaw,
      ).trim() !== '' &&
      tarifaUnidadCanonical ===
        null
    ) {
      rows.push(
        rejectedRow({
          rowNumber,
          codigoProducto,
          anomalyCode:
            'INVALID_TARIFF_VALUE',
          rawData,
          deliveryPointManaged,
          previous,
        }),
      );

      continue;
    }

    const minimumQuantityRaw =
      valueAt(
        values,
        indexes.minimumQuantity,
      );

    const minimumQuantity =
      indexes.minimumQuantity === -1
        ? previous?.minimumQuantity ?? 1
        : parseMinimumQuantity(
            minimumQuantityRaw,
          );

    if (
      indexes.minimumQuantity !== -1 &&
      cellText(
        minimumQuantityRaw,
      ).trim() === ''
    ) {
      rows.push(
        rejectedRow({
          rowNumber,
          codigoProducto,
          anomalyCode:
            'MINIMUM_QUANTITY_REQUIRED',
          rawData,
          deliveryPointManaged,
          previous,
        }),
      );

      continue;
    }

    if (
      indexes.minimumQuantity !== -1 &&
      minimumQuantity === null
    ) {
      rows.push(
        rejectedRow({
          rowNumber,
          codigoProducto,
          anomalyCode:
            'INVALID_MINIMUM_QUANTITY',
          rawData,
          deliveryPointManaged,
          previous,
        }),
      );

      continue;
    }

    const next:
      TariffCommercialSnapshot = {
      codigoProducto,

      tarifaUnidadRaw:
        nullableText(
          tarifaUnidadRaw,
        ),

      tarifaUnidadCanonical,

      numeroExpedienteInvima:
        nullableText(
          valueAt(
            values,
            indexes.numeroExpedienteInvima,
          ),
        ),

      consecutivoInvimaPresentacion:
        nullableText(
          valueAt(
            values,
            indexes.consecutivoInvimaPresentacion,
          ),
        ),

      descripcionGenerica:
        nullableText(
          valueAt(
            values,
            indexes.descripcionGenerica,
          ),
        ),

      descripcionComercial:
        nullableText(
          valueAt(
            values,
            indexes.descripcionComercial,
          ),
        ),

      laboratorio:
        nullableText(
          valueAt(
            values,
            indexes.laboratorio,
          ),
        ),

      tipoInclusion:
        nullableText(
          valueAt(
            values,
            indexes.tipoInclusion,
          ),
        ),

      minimumQuantity:
        minimumQuantity ?? 1,
    };

    let deliveryPointChanged =
      false;

    if (
      deliveryPointManaged
    ) {
      if (
        !deliveryPointHeadersComplete
      ) {
        rows.push(
          rejectedRow({
            rowNumber,
            codigoProducto,
            anomalyCode:
              'DEFAULT_POINT_HEADERS_INCOMPLETE',
            rawData,
            deliveryPointManaged,
            previous,
          }),
        );

        continue;
      }

      const cumRaw =
        nullableText(
          valueAt(
            values,
            indexes.codigoCumFinal,
          ),
        );

      const pointName =
        nullableText(
          valueAt(
            values,
            indexes.puntoAplicacionPredeterminado,
          ),
        );

      const serviceModel =
        nullableText(
          valueAt(
            values,
            indexes.modelo,
          ),
        );

      if (
        pointName &&
        !cumRaw
      ) {
        rows.push(
          rejectedRow({
            rowNumber,
            codigoProducto,
            anomalyCode:
              'CUM_REQUIRED',
            rawData,
            deliveryPointManaged,
            previous,
          }),
        );

        continue;
      }

      if (pointName) {
        const cumIdentity =
          parseCumProductIdentity(
            cumRaw,
          );

        if (!cumIdentity) {
          rows.push(
            rejectedRow({
              rowNumber,
              codigoProducto,
              anomalyCode:
                'INVALID_CUM_CODE',
              rawData,
              deliveryPointManaged,
              previous,
            }),
          );

          continue;
        }

        const tariffInvimaRecord =
          normalizeInvimaComponent(
            next.numeroExpedienteInvima,
          );

        const tariffInvimaPresentation =
          normalizeInvimaComponent(
            next.consecutivoInvimaPresentacion,
          );

        if (
          !tariffInvimaRecord ||
          !tariffInvimaPresentation
        ) {
          rows.push(
            rejectedRow({
              rowNumber,
              codigoProducto,
              anomalyCode:
                'INVIMA_IDENTITY_REQUIRED_FOR_DEFAULT_POINT',
              rawData,
              deliveryPointManaged,
              previous,
            }),
          );

          continue;
        }

        if (
          cumIdentity.invimaRecord !==
            tariffInvimaRecord ||
          cumIdentity.invimaPresentation !==
            tariffInvimaPresentation
        ) {
          rows.push(
            rejectedRow({
              rowNumber,
              codigoProducto,
              anomalyCode:
                'CUM_INVIMA_MISMATCH',
              rawData,
              deliveryPointManaged,
              previous,
            }),
          );

          continue;
        }

        const pointCode =
          normalizeDeliveryPointCode(
            pointName,
          );

        if (!pointCode) {
          rows.push(
            rejectedRow({
              rowNumber,
              codigoProducto,
              anomalyCode:
                'INVALID_DEFAULT_DELIVERY_POINT',
              rawData,
              deliveryPointManaged,
              previous,
            }),
          );

          continue;
        }

        const currentMapping =
          activeMappingByIdentity.get(
            mappingIdentity(
              cumIdentity.invimaRecord,
              cumIdentity.invimaPresentation,
            ),
          );

        deliveryPointChanged =
          !currentMapping ||
          normalizeUpper(
            currentMapping.cumCode,
          ) !==
            normalizeUpper(
              cumIdentity.cumCode,
            ) ||
          normalizeText(
            currentMapping.serviceModel,
          ) !==
            normalizeText(
              serviceModel,
            ) ||
          normalizeText(
            currentMapping.siteName,
          ) !==
            normalizeText(
              pointName,
            ) ||
          currentMapping.dispensingPointCode !==
            pointCode;
      }
    }

    const tariffChanged =
      !previous ||
      !commerciallyEqual(
        previous,
        next,
      );

    if (!previous) {
      rows.push({
        rowNumber,
        codigoProducto,
        state:
          'CHANGED',
        action:
          'NEW',
        anomalyCode:
          null,
        tariffChanged:
          true,
        deliveryPointManaged,
        deliveryPointChanged,
        rawData,
        next,
        previous:
          null,
      });

      continue;
    }

    const anomalyCode =
      detectTariffAnomaly(
        previous.tarifaUnidadCanonical,
        tarifaUnidadCanonical,
      );

    if (anomalyCode) {
      rows.push({
        rowNumber,
        codigoProducto,
        state:
          'ANOMALOUS',
        action:
          'UPDATE',
        anomalyCode,
        tariffChanged:
          true,
        deliveryPointManaged,
        deliveryPointChanged,
        rawData,
        next,
        previous,
      });

      continue;
    }

    if (
      !tariffChanged &&
      !deliveryPointChanged
    ) {
      rows.push({
        rowNumber,
        codigoProducto,
        state:
          'UNCHANGED',
        action:
          'UNCHANGED',
        anomalyCode:
          null,
        tariffChanged:
          false,
        deliveryPointManaged,
        deliveryPointChanged:
          false,
        rawData,
        next,
        previous,
      });

      continue;
    }

    rows.push({
      rowNumber,
      codigoProducto,
      state:
        'CHANGED',
      action:
        'UPDATE',
      anomalyCode:
        null,
      tariffChanged,
      deliveryPointManaged,
      deliveryPointChanged,
      rawData,
      next,
      previous,
    });
  }

  const anomalous =
    rows.filter(
      (row) =>
        row.state ===
        'ANOMALOUS',
    ).length;

  return {
    total:
      rows.length,

    unchanged:
      rows.filter(
        (row) =>
          row.state ===
          'UNCHANGED',
      ).length,

    changed:
      rows.filter(
        (row) =>
          row.state ===
          'CHANGED',
      ).length,

    anomalous,

    rejected:
      rows.filter(
        (row) =>
          row.state ===
          'REJECTED',
      ).length,

    scalePatternDetected:
      anomalous >= 2,

    rows,
  };
}

export function commerciallyEqual(
  previous:
    ActiveTariffProduct,

  next:
    TariffCommercialSnapshot,
): boolean {
  return (
    normalizeTariffProductCode(
      previous.codigoProducto,
    ) ===
      normalizeTariffProductCode(
        next.codigoProducto,
      ) &&

    normalizeCanonical(
      previous.tarifaUnidadCanonical,
    ) ===
      normalizeCanonical(
        next.tarifaUnidadCanonical,
      ) &&

    normalizeText(
      previous.numeroExpedienteInvima,
    ) ===
      normalizeText(
        next.numeroExpedienteInvima,
      ) &&

    normalizeText(
      previous.consecutivoInvimaPresentacion,
    ) ===
      normalizeText(
        next.consecutivoInvimaPresentacion,
      ) &&

    normalizeText(
      previous.descripcionGenerica,
    ) ===
      normalizeText(
        next.descripcionGenerica,
      ) &&

    normalizeText(
      previous.descripcionComercial,
    ) ===
      normalizeText(
        next.descripcionComercial,
      ) &&

    normalizeText(
      previous.laboratorio,
    ) ===
      normalizeText(
        next.laboratorio,
      ) &&

    normalizeText(
      previous.tipoInclusion,
    ) ===
      normalizeText(
        next.tipoInclusion,
      ) &&

    previous.minimumQuantity ===
      next.minimumQuantity
  );
}

function rejectedRow(
  input: {
    rowNumber: number;
    codigoProducto:
      string | null;
    anomalyCode:
      string;
    rawData:
      Record<string, unknown>;
    deliveryPointManaged:
      boolean;
    previous:
      ActiveTariffProduct | null;
  },
): TariffPreviewRow {
  return {
    rowNumber:
      input.rowNumber,

    codigoProducto:
      input.codigoProducto,

    state:
      'REJECTED',

    action:
      'REJECT',

    anomalyCode:
      input.anomalyCode,

    tariffChanged:
      false,

    deliveryPointManaged:
      input.deliveryPointManaged,

    deliveryPointChanged:
      false,

    rawData:
      input.rawData,

    next:
      null,

    previous:
      input.previous,
  };
}

function mappingIdentity(
  invimaRecord:
    string,

  invimaPresentation:
    string,
): string {
  return (
    `${invimaRecord}:` +
    invimaPresentation
  );
}

function detectTariffAnomaly(
  previousCanonical:
    string | null,

  nextCanonical:
    string | null,
): string | null {
  if (
    previousCanonical ===
      null ||
    nextCanonical ===
      null
  ) {
    return null;
  }

  const previous =
    Number(
      previousCanonical,
    );

  const next =
    Number(
      nextCanonical,
    );

  if (
    !Number.isFinite(
      previous,
    ) ||
    !Number.isFinite(
      next,
    ) ||
    previous <= 0 ||
    next < 0
  ) {
    return null;
  }

  const ratio =
    next / previous;

  if (
    ratio >= 900 &&
    ratio <= 1100
  ) {
    return 'TARIFF_SCALE_X1000';
  }

  if (
    ratio >= 0.0009 &&
    ratio <= 0.0011
  ) {
    return 'TARIFF_SCALE_DIV1000';
  }

  return null;
}

function normalizeCanonical(
  value:
    string | null,
): string | null {
  if (
    value === null
  ) {
    return null;
  }

  const numeric =
    Number(value);

  return Number.isFinite(
    numeric,
  )
    ? numeric.toFixed(4)
    : value.trim();
}

function normalizeText(
  value:
    string | null,
): string | null {
  const normalized =
    value?.trim() ?? '';

  return normalized === ''
    ? null
    : normalized;
}

function normalizeUpper(
  value:
    string | null,
): string | null {
  const normalized =
    normalizeText(value);

  return normalized
    ? normalized.toUpperCase()
    : null;
}

function nullableText(
  value:
    unknown,
): string | null {
  const text =
    cellText(value).trim();

  return text === ''
    ? null
    : text;
}

function valueAt(
  values:
    readonly unknown[],

  index:
    number,
): unknown {
  return index === -1
    ? null
    : values[index];
}

function isBlankRow(
  values:
    readonly unknown[],
): boolean {
  return values.every(
    (value) =>
      cellText(value)
        .trim() === '',
  );
}

function normalizeHeader(
  value:
    string,
): string {
  return value
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(
      /[\u0300-\u036f]/g,
      '',
    )
    .replace(
      /[^A-Z0-9]+/g,
      '_',
    )
    .replace(
      /^_+|_+$/g,
      '',
    );
}

function findHeader(
  headers:
    readonly string[],

  candidates:
    readonly string[],
): number {
  for (
    const candidate
    of candidates
  ) {
    const index =
      headers.indexOf(
        candidate,
      );

    if (
      index !== -1
    ) {
      return index;
    }
  }

  return -1;
}

function cellText(
  value:
    unknown,
): string {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  if (
    typeof value ===
      'string'
  ) {
    return value;
  }

  if (
    typeof value ===
      'number' ||
    typeof value ===
      'bigint' ||
    typeof value ===
      'boolean'
  ) {
    return String(value);
  }

  return '';
}
