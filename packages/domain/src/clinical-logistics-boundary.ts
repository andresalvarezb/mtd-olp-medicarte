/** ESP-001 field list. ESP-016 classifications live in `legacy-operational-cutover.ts`. */
export const LEGACY_OPERATIONAL_FIELDS = [
  'lugar_dispensacion',
  'fecha_programada',
  'fecha_dispensacion',
  'fecha_aplicacion',
  'cod_autorizacion_medicarte',
  'orden_compra',
  'process_status',
  'operation_status',
  'operational_version',
] as const;

export type LegacyOperationalField = (typeof LEGACY_OPERATIONAL_FIELDS)[number];

export type ClinicalAuthorizationReference = Readonly<{
  authorizationItemId: string;
  commercialCode: string;
}>;

export type ClinicalAuthorization = Readonly<{
  id: string;
  numeroAutorizacion: string;
  commercialCode: string;
  authorizationKey: string;
  sourceStatusNormalized: string;
  coverageType: string;
  directionStatus: string;
  createdAt: Date;
  updatedAt: Date;
}>;

export type LegacyAuthorizationHistory = Readonly<{
  id: string;
  numeroAutorizacion: string;
  commercialCode: string;
  lugarDispensacion: string | null;
  fechaProgramada: string | null;
  fechaDispensacion: string | null;
  fechaAplicacion: string | null;
  codAutorizacionMedicarte: string | null;
  ordenCompra: string | null;
  processStatus: string | null;
  operationStatus: string | null;
  operationalVersion: number;
  updatedAt: Date;
}>;

export function normalizeCommercialCode(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!normalized) throw new Error('Commercial code is required');
  return normalized;
}

export function createClinicalAuthorizationReference(input: {
  authorizationItemId: string;
  commercialCode: string;
}): ClinicalAuthorizationReference {
  if (!input.authorizationItemId.trim()) throw new Error('Authorization item id is required');
  return {
    authorizationItemId: input.authorizationItemId,
    commercialCode: normalizeCommercialCode(input.commercialCode),
  };
}

export function isLegacyOperationalField(value: string): value is LegacyOperationalField {
  return (LEGACY_OPERATIONAL_FIELDS as readonly string[]).includes(value);
}
