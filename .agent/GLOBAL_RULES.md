# Reglas globales para todos los agentes

## Fuente de verdad

- PostgreSQL es la fuente de verdad transaccional.
- Redis/BullMQ coordina jobs; no es fuente de verdad.
- Google Drive es un repositorio corporativo externo administrado directamente por Medicarte; la aplicación no carga ni cataloga soportes individuales.
- MIPRES es fuente externa oficial para los datos MIPRES aplicables, no para el estado operativo local.

## Reglas de negocio confirmadas

- Unidad mínima: `authorization_item`.
- Llave única: `numero_autorizacion + codigo_medicamento`.
- `codigo_medicamento` proviene de `COD_COMERCIAL`.
- `ESTADO_AUTORIZACION = 5` => `HABILITADO`; cualquier otro valor => `BLOQUEADO_POR_ESTADO_ORIGEN`.
- `normalizar(No.PRESCRIPCION)` vacío => `PBS`; valor no vacío => `NO_PBS` (DEC-016). `CUPS_PRINCIPAL` ya no clasifica cobertura.
- `No.PRESCRIPCION` no vacío debe contener solo dígitos con longitud mayor a 3; `no_prescripcion` para MIPRES es el valor sin sus últimos 3 dígitos de la derecha.
- PBS no requiere consulta MIPRES para clasificación y usa `direction_status = NO_APLICA`.
- Solo `NO_PBS + HABILITADO` entra a validación de direccionamiento MIPRES.
- Un direccionamiento MIPRES es vigente solo si `current_date(America/Bogota) < fecha_maxima`; igualdad con `fecha_maxima` no es válida.
- Medicarte define `lugar_dispensacion` y reporta `fecha_aplicacion` mediante cargas masivas separadas; el contrato externo de esta última usa `authorization_key,fecha_aplicacion_medicamento`.
- OLP reporta `fecha_dispensacion` mediante carga masiva; la primera persistencia produce `DISPENSACION_REPORTADA`.
- `DISPENSADO` solo se produce tras una decisión humana `audit_status = APROBADO`.
- Los reportes operativos son diarios y cubren el día calendario anterior en `America/Bogota`.
- La referencia administrativa al Drive corporativo es parametrizable por MTD Admin; no controla cargas dentro de la aplicación.
- Tamaño máximo inicial para importaciones y actualizaciones masivas: 20 MB.

## Prohibiciones

- No introducir una columna de “estado general” como fuente de verdad.
- No borrar eventos de auditoría ni historial de cambios operativos.
- No enviar Gmail ni invocar MIPRES dentro de una transacción HTTP de negocio.
- No guardar tokens/secretos en frontend, logs o base de datos sin cifrado/gestor definido.
- No implementar endpoints de carga/descarga individual de soportes ni relación obligatoria `attachment -> authorization_item`.
- No inferir completitud de soportes por conteos, tipos o reglas automáticas.
- No duplicar enums o DTOs en web/api/worker: usar paquetes compartidos.
- No hacer acceso directo entre tablas de módulos ajenos cuando exista servicio/contrato de aplicación.
- No implementar decisiones `PENDING` ni completar por inferencia la parte abierta de decisiones `PARTIAL`.
- Los estados de negocio y procesamiento del backend usan el catálogo en español documentado en `docs/architecture/estados-backend.md`; códigos técnicos de error, eventos, colas y operaciones no se traducen.

## Ingeniería

- TypeScript strict.
- Contratos validados en runtime.
- Migraciones revisables y reversibles cuando sea técnicamente razonable.
- Idempotencia obligatoria para mutaciones críticas y jobs.
- Logs estructurados con correlation ID.
- Timestamps persistidos en UTC y presentados en `America/Bogota`; fechas calendario como `fecha_dispensacion` y `fecha_aplicacion` se persisten como `DATE` sin conversión de zona horaria.
- Pruebas unitarias para reglas puras, integración para DB/colas y E2E para historias verticales.

- Una actualización explícita de evidencia F2 para una llave existente solo puede ejecutarse si `operation_status = LISTO_PARA_DISPENSAR`; queda bloqueada desde `DISPENSACION_REPORTADA`. Esta regla no bloquea correcciones operativas tipadas de ADR-022.
- Una actualización explícita reemplaza la evidencia y reevalúa las cuatro columnas de negocio (`NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION`, `No.PRESCRIPCION`), manteniendo la pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL`; recalcula `operation_status`: solo `HABILITADO + PBS + NO_APLICA` o `HABILITADO + NO_PBS + CONFIRMADO` conserva `LISTO_PARA_DISPENSAR`; cualquier otra combinación queda `BLOQUEADO`.
- Los reportes diarios se ejecutan a las 08:00 `America/Bogota` y cubren el día anterior.
- Los destinatarios son parametrizables y sus cambios se auditan.
- Solo una persona autorizada puede producir `audit_status = APROBADO`; no existe aprobación automática.
- La aplicación no gobierna retención, versiones ni completitud de los soportes del Drive corporativo.
- Las exportaciones CSV/XLSX son on-demand y no persistentes.
- Máximo 20 MB por archivo de importación o actualización masiva; no existe límite mensual de soportes porque la aplicación no los recibe.
- Despliegue esperado: Render; alternativa Google Cloud; región requerida Colombia.

- El producto vive en un repositorio nuevo e independiente de GitHub, estructurado como monorepo; no se integra en `vita-back` ni `vita-core`.

- Al entrar en `LISTO_PARA_DISPENSAR`, se notifica a OLP y Medicarte.
- Medicarte es el único actor operativo que define/modifica masivamente `lugar_dispensacion` y reporta masivamente `fecha_aplicacion`.
- OLP es el único actor operativo que reporta masivamente `fecha_dispensacion`.
- Los tres valores vigentes se persisten en `authorization_items`; cada cambio conserva historial append-only, versión y auditoría.
- Asignar o cambiar `lugar_dispensacion` notifica a OLP mediante outbox después del commit.
- `application_site_status` es derivado de `lugar_dispensacion`; `support_status` no se persiste.
- `authorization_items` es un registro global único; su lectura multi-organización se controla con permisos y `authorization_item_organizations`, sin duplicarlo por empresa.
- En Fase 2 las cuatro columnas de negocio validadas son `NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION` y `No.PRESCRIPCION`; las demás columnas del archivo se conservan como evidencia sin reglas semánticas adicionales no documentadas.
- Las descargas operativas contienen la base completa permitida por alcance y sensibilidad. Cada carga operativa contiene exactamente la llave de negocio y un único campo autorizado.
- Los bulk updates reutilizan staging, fuente temporal PostgreSQL `BYTEA`, BullMQ con identificadores, idempotencia, causales por fila y auditoría; el backend fija columnas y permisos por tipo de operación.

- La reversión de un cargue (ADR-023/DEC-017) elimina únicamente los `authorization_items` con `created_from_batch_id` igual al lote, mediante hard delete controlado transaccional con permiso `imports.revert` (solo MTD_ADMIN). Los ítems preexistentes nunca se eliminan; la actividad posterior bloquea con causal estable; el `import_batch` se conserva como evidencia histórica con estado `REVERTIDO`; la auditoría sobrevive al borrado.

- Solo los registros exclusivamente `LISTO_PARA_DISPENSAR` sin intervención operativa (DEC-018) pueden expirar por `FECHA_FINAL_VIGENCIA`. Un registro con `lugar_dispensacion`, `fecha_dispensacion`, `fecha_aplicacion` no nulos o `operational_version > 0` preserva su estado y trazabilidad aunque la vigencia haya expirado.
- Las descargas operativas, consolidadas y de EPS novedades usan las columnas canónicas definidas en DEC-019: `NUMERO_AUTORIZACION`, `NUM_DOCUMENTO`, `NOMBRE_PACIENTE`, `CDGN001`, `COD_COMERCIAL`, `CUPS_AUTORIZADO`, `CANTIDAD`, `DOSIS`, `FECHA_ASIGNACION`, `FECHA_FINAL_VIGENCIA`, `ESTADO_AUTORIZACION`, `No.PRESCRIPCION`, más las columnas derivadas del proceso; `CPRG` no se expone.
