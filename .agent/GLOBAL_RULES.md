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
- `ESTADO_AUTORIZACION = 5` => `ENABLED`; cualquier otro valor => `BLOCKED_SOURCE_STATUS`.
- `normalizar(No.PRESCRIPCION)` vacío => `PBS`; valor no vacío => `NO_PBS` (DEC-016). `CUPS_PRINCIPAL` ya no clasifica cobertura.
- `No.PRESCRIPCION` no vacío debe contener solo dígitos con longitud mayor a 3; `no_prescripcion` para MIPRES es el valor sin sus últimos 3 dígitos de la derecha.
- PBS no requiere consulta MIPRES para clasificación y usa `direction_status = NOT_APPLICABLE`.
- Solo `NO_PBS + ENABLED` entra a validación de direccionamiento MIPRES.
- Un direccionamiento MIPRES es vigente solo si `current_date(America/Bogota) < fecha_maxima`; igualdad con `fecha_maxima` no es válida.
- Medicarte define `lugar_dispensacion` y reporta `fecha_aplicacion` mediante cargas masivas separadas.
- OLP reporta `fecha_dispensacion` mediante carga masiva; la primera persistencia produce `DISPENSATION_REPORTED`.
- `DISPENSED` solo se produce tras una decisión humana `audit_status = APPROVED`.
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

## Ingeniería

- TypeScript strict.
- Contratos validados en runtime.
- Migraciones revisables y reversibles cuando sea técnicamente razonable.
- Idempotencia obligatoria para mutaciones críticas y jobs.
- Logs estructurados con correlation ID.
- Timestamps persistidos en UTC y presentados en `America/Bogota`; fechas calendario como `fecha_dispensacion` y `fecha_aplicacion` se persisten como `DATE` sin conversión de zona horaria.
- Pruebas unitarias para reglas puras, integración para DB/colas y E2E para historias verticales.

- Una actualización explícita de evidencia F2 para una llave existente solo puede ejecutarse si `operation_status = READY_TO_DISPENSE`; queda bloqueada desde `DISPENSATION_REPORTED`. Esta regla no bloquea correcciones operativas tipadas de ADR-022.
- Una actualización explícita reemplaza la evidencia y reevalúa las cuatro columnas de negocio (`NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION`, `No.PRESCRIPCION`), manteniendo la pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL`; recalcula `operation_status`: solo `ENABLED + PBS + NOT_APPLICABLE` o `ENABLED + NO_PBS + CONFIRMED` conserva `READY_TO_DISPENSE`; cualquier otra combinación queda `BLOCKED`.
- Los reportes diarios se ejecutan a las 08:00 `America/Bogota` y cubren el día anterior.
- Los destinatarios son parametrizables y sus cambios se auditan.
- Solo una persona autorizada puede producir `audit_status = APPROVED`; no existe aprobación automática.
- La aplicación no gobierna retención, versiones ni completitud de los soportes del Drive corporativo.
- Las exportaciones CSV/XLSX son on-demand y no persistentes.
- Máximo 20 MB por archivo de importación o actualización masiva; no existe límite mensual de soportes porque la aplicación no los recibe.
- Despliegue esperado: Render; alternativa Google Cloud; región de producción aprobada: Virginia (USA); la ausencia de región Colombia no bloquea producción.

- El producto vive en un repositorio nuevo e independiente de GitHub, estructurado como monorepo; no se integra en `vita-back` ni `vita-core`.

- Al entrar en `READY_TO_DISPENSE`, se notifica a OLP y Medicarte.
- Medicarte es el único actor operativo que define/modifica masivamente `lugar_dispensacion` y reporta masivamente `fecha_aplicacion`.
- OLP es el único actor operativo que reporta masivamente `fecha_dispensacion`.
- Los tres valores vigentes se persisten en `authorization_items`; cada cambio conserva historial append-only, versión y auditoría.
- Asignar o cambiar `lugar_dispensacion` notifica a OLP mediante outbox después del commit.
- `application_site_status` es derivado de `lugar_dispensacion`; `support_status` no se persiste.
- `authorization_items` es un registro global único; su lectura multi-organización se controla con permisos y `authorization_item_organizations`, sin duplicarlo por empresa.
- En Fase 2 las cuatro columnas de negocio validadas son `NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION` y `No.PRESCRIPCION`; las demás columnas del archivo se conservan como evidencia sin reglas semánticas adicionales no documentadas.
- Las descargas operativas contienen la base completa permitida por alcance y sensibilidad. Cada carga operativa contiene exactamente la llave de negocio y un único campo autorizado.
- Los bulk updates reutilizan staging, fuente temporal PostgreSQL `BYTEA`, BullMQ con identificadores, idempotencia, causales por fila y auditoría; el backend fija columnas y permisos por tipo de operación.
