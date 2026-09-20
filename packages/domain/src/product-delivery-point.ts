function text(value: unknown): string {
  if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
    return '';
  }

  return String(value).trim();
}

/**
 * Normaliza componentes INVIMA para que:
 *
 * 03  -> 3
 * 003 -> 3
 * 20039088 -> 20039088
 * 00200666 -> 200666
 *
 * La identidad es semántica/numeral, no de formato de Excel.
 */
export function normalizeInvimaComponent(value: unknown): string | null {
  const raw = text(value);

  if (!raw || !/^\d+$/.test(raw)) {
    return null;
  }

  const normalized = raw.replace(/^0+(?=\d)/, '');

  return normalized || '0';
}

export type CumProductIdentity = Readonly<{
  cumCode: string;
  invimaRecord: string;
  invimaPresentation: string;
}>;

/**
 * Extrae expediente + presentación del CUM:
 *
 * 20039088-03-0S01LA05
 *             ↓
 * expediente=20039088
 * presentación=3
 */
export function parseCumProductIdentity(value: unknown): CumProductIdentity | null {
  const raw = text(value);

  if (!raw) {
    return null;
  }

  const match = raw.match(/^(\d+)\s*-\s*(\d+)(?:-|$)/);

  if (!match) {
    return null;
  }

  const invimaRecord = normalizeInvimaComponent(match[1]);
  const invimaPresentation = normalizeInvimaComponent(match[2]);

  if (!invimaRecord || !invimaPresentation) {
    return null;
  }

  return {
    cumCode: raw.toUpperCase(),
    invimaRecord,
    invimaPresentation,
  };
}

/**
 * Código estable para dispensing_points.
 *
 * "CENTUM "       -> CENTUM
 * "Clínica Norte" -> CLINICA_NORTE
 */
export function normalizeDeliveryPointCode(value: unknown): string | null {
  const raw = text(value);

  if (!raw) {
    return null;
  }

  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 80);
}
