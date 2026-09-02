/**
 * Campos base que toda descarga debe incluir (columnas originales del archivo
 * de autorizaciones, preservadas en source_data), en su orden canónico.
 * A estos se suman las columnas creadas por sección del proceso.
 */
export const sourceBaseColumns = [
  'NUMERO_AUTORIZACION',
  'IDENTIFICACION_PACIENTE',
  'NOMBRE_PACIENTE',
  'CDGN001',
  'CODIGO_COMERCIAL',
  'CUPS_AUTORIZADO',
  'CANTIDAD',
  'DOSIS',
  'FECHA_ASIGNACION',
  'FECHA_FINAL_VIGENCIA',
  'VALOR_CUOTA_MODERADORA',
  'NUMERO_PRESCRIPCION',
] as const;

const sourceColumnAliases: Record<(typeof sourceBaseColumns)[number], string> = {
  NUMERO_AUTORIZACION: 'numero_autorizacion',
  IDENTIFICACION_PACIENTE: 'numero_documento',
  NOMBRE_PACIENTE: 'nombre_paciente',
  CDGN001: 'cdgn001',
  CODIGO_COMERCIAL: 'codigo_medicamento',
  CUPS_AUTORIZADO: 'cups_autorizado',
  CANTIDAD: 'cantidad',
  DOSIS: 'dosis',
  FECHA_ASIGNACION: 'fecha_asignacion',
  FECHA_FINAL_VIGENCIA: 'fecha_final_vigencia',
  VALOR_CUOTA_MODERADORA: 'valor_cuota_moderadora',
  NUMERO_PRESCRIPCION: 'no_prescripcion',
};

const legacySourceColumnNames: Partial<Record<(typeof sourceBaseColumns)[number], string>> = {
  IDENTIFICACION_PACIENTE: 'NUM_DOCUMENTO',
  CODIGO_COMERCIAL: 'COD_COMERCIAL',
  VALOR_CUOTA_MODERADORA: 'VALOR CUOTA MODERADORA',
  NUMERO_PRESCRIPCION: 'No.PRESCRIPCION',
};

export const authorizationDownloadColumns = [
  'id',
  ...sourceBaseColumns,
  'enablement_status',
  'coverage_type',
  'direction_status',
  'operation_status',
  'lugar_dispensacion',
  'fecha_programada',
  'fecha_dispensacion',
  'fecha_aplicacion',
  'audit_status',
  'admission_status',
  'application_site_status',
  'operational_version',
  'version',
  'created_at',
  'updated_at',
] as const;

/**
 * Fragmento SQL que extrae los campos base desde source_data. NUMERO_AUTORIZACION
 * y COD_COMERCIAL provienen de columnas normalizadas, por lo que se excluyen.
 */
export function sourceBaseSelectSql(tableAlias = 'i'): string {
  return sourceBaseColumns
    .filter((column) => column !== 'NUMERO_AUTORIZACION' && column !== 'CODIGO_COMERCIAL')
    .map((column) => {
      const legacy = legacySourceColumnNames[column];
      const expression = legacy
        ? `coalesce(${tableAlias}.source_data->>'${column}', ${tableAlias}.source_data->>'${legacy}')`
        : `${tableAlias}.source_data->>'${column}'`;
      return `${expression} as ${sourceColumnAliases[column]}`;
    })
    .join(', ');
}
