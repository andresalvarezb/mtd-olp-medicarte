/**
 * Campos de origen que toda descarga de autorizaciones debe incluir. CPRG se
 * conserva en la evidencia de origen, pero se omite intencionalmente de las
 * descargas; CDGN001 sí forma parte de la proyección de descargas.
 */
export const sourceBaseColumns = [
  'NUMERO_AUTORIZACION',
  'NUM_DOCUMENTO',
  'NOMBRE_PACIENTE',
  'CDGN001',
  'COD_COMERCIAL',
  'CUPS_AUTORIZADO',
  'CANTIDAD',
  'DOSIS',
  'FECHA_ASIGNACION',
  'FECHA_FINAL_VIGENCIA',
  'ESTADO_AUTORIZACION',
  'No.PRESCRIPCION',
] as const;

const sourceColumnAliases: Record<(typeof sourceBaseColumns)[number], string> = {
  NUMERO_AUTORIZACION: 'numero_autorizacion',
  NUM_DOCUMENTO: 'numero_documento',
  NOMBRE_PACIENTE: 'nombre_paciente',
  CDGN001: 'cdgn001',
  COD_COMERCIAL: 'codigo_medicamento',
  CUPS_AUTORIZADO: 'cups_autorizado',
  CANTIDAD: 'cantidad',
  DOSIS: 'dosis',
  FECHA_ASIGNACION: 'fecha_asignacion',
  FECHA_FINAL_VIGENCIA: 'fecha_final_vigencia',
  ESTADO_AUTORIZACION: 'estado_autorizacion',
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
