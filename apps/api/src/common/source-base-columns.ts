/**
 * Campos base que toda descarga debe incluir (columnas originales del archivo
 * de autorizaciones, preservadas en source_data), en su orden canónico.
 * A estos se suman las columnas creadas por sección del proceso.
 */
export const sourceBaseColumns = [
  'NUMERO_AUTORIZACION',
  'NUM_DOCUMENTO',
  'NOMBRE_PACIENTE',
  'COD_COMERCIAL',
  'CUMS',
  'COD_CUPS_AUTORIZADO',
  'CUPS_AUTORIZADO',
  'CANTIDAD',
  'DOSIS',
  'FECHA_ASIGNACION',
  'FECHA_FINAL_VIGENCIA',
  'ESTADO_AUTORIZACION',
  'OBS_AUTORIZACION',
  'VALOR CUOTA MODERADORA',
  'No.PRESCRIPCION',
] as const;

const sourceColumnAliases: Record<(typeof sourceBaseColumns)[number], string> = {
  NUMERO_AUTORIZACION: 'numero_autorizacion',
  NUM_DOCUMENTO: 'numero_documento',
  NOMBRE_PACIENTE: 'nombre_paciente',
  COD_COMERCIAL: 'codigo_medicamento',
  CUMS: 'cums',
  COD_CUPS_AUTORIZADO: 'cod_cups_autorizado',
  CUPS_AUTORIZADO: 'cups_autorizado',
  CANTIDAD: 'cantidad',
  DOSIS: 'dosis',
  FECHA_ASIGNACION: 'fecha_asignacion',
  FECHA_FINAL_VIGENCIA: 'fecha_final_vigencia',
  ESTADO_AUTORIZACION: 'estado_autorizacion',
  OBS_AUTORIZACION: 'obs_autorizacion',
  'VALOR CUOTA MODERADORA': 'valor_cuota_moderadora',
  'No.PRESCRIPCION': 'no_prescripcion',
};

/**
 * Fragmento SQL que extrae los campos base desde source_data. NUMERO_AUTORIZACION
 * y COD_COMERCIAL provienen de columnas normalizadas, por lo que se excluyen.
 */
export function sourceBaseSelectSql(tableAlias = 'i'): string {
  return sourceBaseColumns
    .filter((column) => column !== 'NUMERO_AUTORIZACION' && column !== 'COD_COMERCIAL')
    .map((column) => `${tableAlias}.source_data->>'${column}' as ${sourceColumnAliases[column]}`)
    .join(', ');
}
