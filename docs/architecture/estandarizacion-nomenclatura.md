# Auditoria de nomenclatura transversal

Fecha de auditoria: 2026-09-01

## Alcance revisado

Se revisaron contratos compartidos, parsers CSV/XLSX, exportaciones, servicios
API, worker, dominio, esquema y migraciones SQL, frontend, pruebas, ADRs y
especificaciones. Los valores de MIPRES se trataron como contrato externo y no
se incluyeron en el renombrado del payload del proveedor.

## Encabezados encontrados

| Nombre actual | Nombre canonico | Uso | Origen / consumidores |
| --- | --- | --- | --- |
| `NUMERO_AUTORIZACION` | `NUMERO_AUTORIZACION` | Identificador de autorizacion | Archivo de autorizaciones, dominio, exportaciones |
| `COD_COMERCIAL` | `CODIGO_COMERCIAL` | Codigo comercial de medicamento | Archivo de autorizaciones y cruce con Anexo Tarifario |
| `No.PRESCRIPCION` | `NUMERO_PRESCRIPCION` | Numero de prescripcion fuente | Archivo de autorizaciones; entrada de clasificacion |
| `VALOR CUOTA MODERADORA` | `VALOR_CUOTA_MODERADORA` | Valor de cuota moderadora | Archivo de autorizaciones y exportaciones |
| `_Id` | `IDENTIFICADOR_FUENTE` | Identificador de fuente | Archivo de autorizaciones |
| `authorization_key` | `CLAVE_AUTORIZACION` | Llave compuesta normalizada `NUMERO_AUTORIZACION` + `CODIGO_MEDICAMENTO` | Cargues operativos, persistencia y cruces |
| `numero_autorizacion` | `NUMERO_AUTORIZACION` | Componente de llave operativa | Cargue de fecha de aplicacion |
| `codigo_medicamento` | `CODIGO_PRODUCTO` | Codigo usado para el cruce con Anexo Tarifario | Cargue operativo, autorizaciones y Anexo Tarifario |
| `lugar_dispensacion` | `LUGAR_DISPENSACION` | Lugar operativo | Cargue y exportaciones |
| `fecha_dispensacion` | `FECHA_DISPENSACION` | Fecha operativa OLP | Cargue y exportaciones |
| `fecha_aplicacion` | `FECHA_APLICACION` | Fecha operativa Medicarte | Cargue y exportaciones |
| `Codigo Medicamento` | `CODIGO_PRODUCTO` | Codigo del producto tarifario | Cargue de Anexo Tarifario; cruce con `CODIGO_PRODUCTO` |
| `Tarifa de la unidad` | `TARIFA_UNIDAD` | Tarifa unitaria | Cargue de Anexo Tarifario |
| `Número de Expediente del INVIMA` | `NUMERO_EXPEDIENTE_INVIMA` | Expediente sanitario | Cargue de Anexo Tarifario |
| `Consecutivo INVIMA (Presentación)` | `CONSECUTIVO_INVIMA_PRESENTACION` | Consecutivo de presentacion | Cargue de Anexo Tarifario |
| `Descripción Genérica del Medicamento (DCI)` | `DESCRIPCION_GENERICA_MEDICAMENTO` | Descripcion generica | Cargue de Anexo Tarifario |
| `Descripción Comercial del Medicamento` | `DESCRIPCION_COMERCIAL_MEDICAMENTO` | Descripcion comercial | Cargue de Anexo Tarifario |
| `Laboratorio del Medicamento` | `LABORATORIO_MEDICAMENTO` | Laboratorio | Cargue de Anexo Tarifario |
| `Tipo de Inclusion del Medicamento (PBS/NOPBS)` | `TIPO_INCLUSION_MEDICAMENTO` | Tipo de inclusion | Cargue de Anexo Tarifario |

Los encabezados de fuente que ya cumplen la forma tecnica se conservan, salvo
la correccion semantica de `COD_COMERCIAL` a `CODIGO_COMERCIAL` y de
`No.PRESCRIPCION` a `NUMERO_PRESCRIPCION`. Los alias de entrada se aceptaran
solo en la frontera y no seran parte del contrato de salida.

## Estados funcionales encontrados

| Nombre actual | Nombre canonico | Dimension |
| --- | --- | --- |
| `UPLOADED` | `CARGADO` | Lote de importacion |
| `VALIDATING` | `VALIDANDO` | Lote de importacion |
| `READY_TO_CONFIRM` | `LISTO_PARA_CONFIRMAR` | Lote de importacion |
| `CONFIRMING` | `CONFIRMANDO` | Lote de importacion |
| `COMPLETED` | `COMPLETADO` | Lote de importacion |
| `FAILED` | `FALLIDO` | Lote de importacion |
| `CANCELLED` | `CANCELADO` | Lote de importacion |
| `ENABLED` | `HABILITADO` | Habilitacion |
| `BLOCKED_SOURCE_STATUS` | `BLOQUEADO_POR_ESTADO_FUENTE` | Habilitacion |
| `NOT_APPLICABLE` | `NO_APLICA` | Direccionamiento |
| `PENDING` | `PENDIENTE` | Direccionamiento, notificacion y otros flujos, segun tabla |
| `CONFIRMED` | `CONFIRMADO` | Direccionamiento |
| `QUERY_ERROR` | `ERROR_CONSULTA` | Direccionamiento |
| `BLOCKED` | `BLOQUEADO` | Operacion |
| `READY_TO_DISPENSE` | `LISTO_PARA_DISPENSAR` | Operacion |
| `DISPENSATION_REPORTED` | `DISPENSACION_REPORTADA` | Operacion |
| `DISPENSED` | `DISPENSADO` | Operacion |
| `EXPIRED` | `VENCIDO` | Operacion |
| `NOT_STARTED` | `NO_INICIADO` | Auditoria |
| `READY` | `LISTO` | Auditoria y admision, segun dimension |
| `IN_REVIEW` | `EN_REVISION` | Auditoria |
| `REJECTED` | `RECHAZADO` | Auditoria |
| `APPROVED` | `APROBADO` | Auditoria |
| `NOT_READY` | `NO_LISTO` | Admision |
| `PENDING_ASSIGNMENT` | `PENDIENTE_DE_ASIGNACION` | Lugar de dispensacion |
| `ASSIGNED` | `ASIGNADO` | Lugar de dispensacion |
| `NOT_EVALUATED` | `NO_EVALUADO` | Pertenencia al Anexo Tarifario |
| `LISTED` | `INCLUIDO` | Pertenencia al Anexo Tarifario |
| `NOT_LISTED` | `NO_INCLUIDO` | Pertenencia al Anexo Tarifario |

No se traducen nombres de colas, nombres de jobs, nombres de endpoints ni
payloads oficiales de terceros. Los codigos tecnicos de error y auditoria se
consideran un contrato separado y requieren migracion coordinada, no un
reemplazo textual.

## Cruces afectados

| Cruce | Regla observada | Cambio requerido |
| --- | --- | --- |
| Autorizaciones ↔ Anexo Tarifario | `authorization_items.codigo_medicamento` contra `tariff_annex_products.codigo_producto` | Ambos lados deben exponerse como `CODIGO_PRODUCTO`; el valor se normaliza con la misma regla |
| Cargue operativo ↔ autorizaciones | `authorization_key` o pareja `numero_autorizacion` + `codigo_medicamento` | Resolver aliases a `CLAVE_AUTORIZACION`, `NUMERO_AUTORIZACION` y `CODIGO_PRODUCTO` antes de procesar |
| Autorizaciones ↔ MIPRES | `no_prescripcion` interno hacia adaptador MIPRES | Mantener `NoPrescripcion` y demás nombres en DTO externo; mapear a `NUMERO_PRESCRIPCION` internamente |
| Autorizaciones ↔ exportaciones | SQL en `snake_case` y columnas exportadas mixtas | Usar el catálogo canonico para construir CSV/XLSX |

## Hallazgos de implementación

1. `apps/worker/src/imports/import-parser.ts`, `bulk-parser.ts` y
   `tariff-import-parser.ts` duplican la lectura y limpieza de encabezados y
   ninguno elimina tildes, caracteres especiales o alias.
2. `packages/contracts/src/index.ts` contiene los contratos de entrada de
   archivos y estados compartidos; es el punto adecuado para el catálogo
   canonico, mientras que la sanitizacion reutilizable debe vivir en un
   modulo neutral consumible por worker y contratos.
3. `apps/api/src/operational-exports/operational-exports.service.ts` y
   `consolidation.service.ts` duplican columnas de proceso y actualmente
   exportan nombres en ingles o no sanitizados.
4. `packages/database/src/schema.ts` y las migraciones persisten columnas y
   valores de estado en ingles. Renombrarlos requiere migracion SQL con
   backfill, constraints, indices, ORM, consultas y rollback operativo.
5. Las pruebas de integracion y dominio afirman directamente los estados
   ingleses y las columnas legacy; deben migrarse junto con el contrato, no
   mediante reemplazo global.

## Plan de migracion

1. Introducir el catalogo canonico y una unica funcion de sanitizacion.
2. Normalizar encabezados en los tres parsers y resolver aliases solo en la
   frontera de importacion.
3. Cambiar contratos propios, cruces, exportadores, DTOs y frontend al modelo
   canonico; aislar MIPRES mediante mapper.
4. Migrar estados y columnas de base de datos en una migracion transaccional,
   conservando datos, indices y constraints, con script de rollback documentado.
5. Actualizar pruebas y documentacion y ejecutar regresion de API, worker,
   frontend, exportaciones e importaciones.
