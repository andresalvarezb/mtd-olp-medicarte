# FASE 1 - Mapeo actual a objetivo

Este documento aplica la especificacion funcional vigente del proyecto. Cuando
existe una diferencia con documentos anteriores del repositorio, prevalece la
especificacion vigente. Esta fase no elimina datos ni funcionalidades.

## 1. Matriz de mapeo

| Actual | Objetivo | Accion |
| --- | --- | --- |
| `authorization_items` | Registro central identificado por `LLAVE` | CONSERVAR y MODIFICAR |
| `numero_autorizacion` + `codigo_medicamento` | `NUMERO_AUTORIZACION` + `CODIGO_COMERCIAL` para generar `LLAVE` | CONSERVAR; validar formato actual e inmutabilidad |
| `authorization_key` con formato actual escapado | `LLAVE` unica e inmutable | CONSERVAR el formato actual; renombrar solo en contrato/UI si es necesario |
| `source_data` JSONB | Columnas fuente del contrato de autorizaciones | CONSERVAR como evidencia; normalizar campos funcionales sin borrar originales |
| `enablement_status` | Resultado de validacion de autorizacion | CONSERVAR como dimension interna; proyectar a estado objetivo |
| `coverage_type` | PBS / NO PBS | MODIFICAR: prescripcion vacia o exactamente 20 digitos |
| `direction_status` | Validacion MIPRES humana | MODIFICAR: dejar de decidir avance automaticamente por `FecMaxEnt` |
| `operation_status` | Estados operativos objetivo | MIGRAR mediante proyeccion controlada; conservar valores historicos |
| `audit_status` | Auditoria humana objetivo | MODIFICAR para incluir rechazo, reversa y novedad activa sin perder revisiones |
| `admission_status` | Fuera del flujo objetivo salvo compatibilidad historica | CONSERVAR historico; no usarlo como sustituto de auditoria |
| `DISPENSATION_REPORTED` / `DISPENSED` | `PENDIENTE_APLICACION` / `LISTO_PARA_AUDITORIA` y estados posteriores | MIGRAR con regla basada en fechas, auditoria y trazabilidad |
| `EXPIRED` | `NOVEDAD` antes de dispensacion | CONSERVAR historico; dejar de usarlo como estado operativo final nuevo |
| `BLOCKED_SOURCE_STATUS` | `NOVEDAD` cuando corresponda | CONSERVAR evidencia; agregar codigo de novedad |
| `direction_status = PENDING` | `PENDIENTE_VALIDACION_MIPRES` para NO PBS | MODIFICAR proyeccion y acciones humanas |
| `import_batches` | Cargue con hash, resumen y estado objetivo | CONSERVAR y MODIFICAR |
| Estados `UPLOADED`, `VALIDATING`, `READY_TO_CONFIRM`, `CONFIRMING`, `COMPLETED` | `RECIBIDO`, `PROCESANDO`, `PROCESADO`, `PROCESADO_CON_NOVEDADES`, `RECHAZADO_ARCHIVO_DUPLICADO`, `FALLIDO` | MIGRAR por capa de compatibilidad; no cambiar historico destructivamente |
| `import_rows` / `validation_errors` | Novedades por fila con fila original y detalle | CONSERVAR; complementar con catalogo y exportacion XLSX |
| `bulk_update_batches` | Cargues operativos XLSX por etapa | CONSERVAR y MODIFICAR |
| `bulk_update_rows` | Novedades detalladas por fila | CONSERVAR; mapear resultados a catalogo unico |
| `tariff_annex_products` | Anexo Tarifario activo con PBS/NO PBS valido | CONSERVAR y MODIFICAR |
| `tariff_annex_imports` | Carga parcial XLSX del Anexo | CONSERVAR como contrato funcional XLSX |
| `mipres_checks` / `mipres_directions` | Consulta mostrada y decision humana | CONSERVAR evidencia; no usar `FecMaxEnt` para aprobar |
| `audit_events` | Trazabilidad append-only completa | CONSERVAR y ampliar acciones/cambios de estado |
| `operational_field_changes` | Historial de cambios operativos | CONSERVAR; añadir actor, cargue y version donde falte |
| `version` / `operational_version` | Concurrencia optimista | CONSERVAR y completar `updated_by`, `last_load_id` o equivalente |
| No existe tabla unica de novedades | `NOVEDADES` centralizada | REEMPLAZAR la fragmentacion funcional, conservando fuentes historicas |
| `notification_templates`, `notifications`, `outbox_events` | Sin notificaciones automaticas del flujo nuevo | MARCAR OBSOLETO; retirar solo tras verificar dependencias |
| `Fallos recuperables` | Vista `Novedades` | REEMPLAZAR despues de validar el nuevo modelo |
| `Notificaciones` | Fuera del flujo funcional objetivo | ELIMINAR despues de migracion y validacion |
| `attachments` permisos historicos | Soportes externos en Google Drive | CONSERVAR solo datos historicos; no crear repositorio de PDFs |
| Configuracion Drive inexistente | URL de carpeta configurada por Admin | MODIFICAR |
| JWT local HS256 + Argon2id | Usuario, password, JWT de 12 horas | CONSERVAR; ajustar TTL fijo/validado y claims resolubles |
| Roles `MTD_ADMIN`, `MTD_OPERATOR`, etc. | Roles `MTD-Admin`, `MTD-Auditoria`, `MTD-General`, `MTD-compras`, `olp`, `medicarte` | MIGRAR mediante alias/codigos canonicos sin eliminar asignaciones historicas |
| `/consolidado` solo aprobado por defecto | Estado actual de todos los registros | MODIFICAR; solo lectura y descarga XLSX |
| Descargas XLSX | Libro Excel, fechas `YYYY-MM-DD` | ESTÁNDAR FUNCIONAL |
| Paginacion variable 25/50 | 30 por pagina, precarga maxima 100 | MODIFICAR componente comun |
| Filtros parciales | Numero de autorizacion AND identificacion de paciente | MODIFICAR backend y frontend |
| `ELIMINAR CARGUE` inexistente o parcial | Eliminacion selectiva y resumen de conservados | IMPLEMENTAR |

## 2. Proyeccion de estados objetivo

No se sobrescribiran estados historicos. Se agregara una proyeccion de estado
funcional, calculada a partir de los datos actuales y actualizada dentro de las
transacciones de negocio.

| Condicion actual/historica | Estado objetivo |
| --- | --- |
| Error de carga, producto invalido, prescripcion invalida, vencimiento pre-dispensacion o rechazo humano | `NOVEDAD` |
| NO PBS clasificado y pendiente de decision humana MIPRES | `PENDIENTE_VALIDACION_MIPRES` |
| PBS valido o NO PBS aprobado, vigente y sin inicio MEDICARTE | `LISTO_PARA_DISPENSAR` |
| MEDICARTE completo con los tres campos iniciales | `PENDIENTE_ORDEN_COMPRA` |
| Orden de compra registrada | `PENDIENTE_DISPENSACION` |
| Fecha de dispensacion registrada | `PENDIENTE_APLICACION` |
| Fecha de aplicacion registrada | `LISTO_PARA_AUDITORIA` |
| Auditoria aprobada | `AUDITORIA_APROBADA` |
| Auditoria rechazada | `AUDITORIA_RECHAZADA` y novedad activa |

Los registros antiguos que no puedan mapearse con seguridad no se moveran
automaticamente: quedaran con su estado historico, una marca de migracion
pendiente y trazabilidad para conciliacion humana.

## 3. Estrategia de migracion

1. Crear columnas/tablas nuevas sin eliminar las anteriores.
2. Poblar `LLAVE` desde los componentes existentes usando exactamente la
   funcion actual `buildAuthorizationKey`.
3. Detectar colisiones antes de crear la restriccion unica; ninguna colision se
   resolvera sobrescribiendo registros.
4. Crear catalogo y novedades para representar errores ya existentes sin
   borrar `import_rows`, `validation_errors` ni auditorias.
5. Calcular el estado objetivo solo cuando los datos permitan una decision
   determinista.
6. Mantener columnas antiguas en lectura durante la transicion y retirar su uso
   funcional solo despues de validar el flujo completo.
7. Hacer cada migracion reversible cuando PostgreSQL y los datos lo permitan.
8. Registrar usuario/sistema, fecha, estado anterior, estado nuevo, cargue y
   motivo de cada conversion.

## 4. Riesgos bloqueantes para FASE 2

- Existen colisiones potenciales si datos historicos no fueron normalizados con
  la funcion actual de llave.
- La regla actual de prescripcion acepta longitudes distintas de 20 digitos.
- La base no tiene un modelo central de novedades.
- Faltan `COD_AUTORIZACION_MEDICARTE`, `updated_by` y `last_load_id` explicitos.
- Las restricciones actuales fuerzan relaciones entre aprobacion y
  `DISPENSED` que no corresponden al flujo nuevo.
- Hay cargas y exportaciones XLSX en API, worker y frontend.
- El estado de cargue actual no tiene la semantica de archivo duplicado
  rechazada requerida.

## 5. Gate de FASE 1

Estado: **VALIDADO**.

La estrategia permite avanzar a FASE 2 sin borrar informacion y con las
divergencias funcionales identificadas. FASE 2 debe implementar primero una
migracion aditiva, restricciones nuevas compatibles y pruebas de datos
historicos antes de activar el flujo objetivo.
