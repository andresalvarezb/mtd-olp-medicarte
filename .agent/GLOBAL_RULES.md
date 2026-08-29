# Reglas globales para todos los agentes

## Fuente de verdad

- PostgreSQL es la fuente de verdad transaccional.
- Redis/BullMQ coordina jobs; no es fuente de verdad.
- Google Drive guarda binarios; PostgreSQL guarda metadatos y referencias.
- MIPRES es fuente externa oficial para los datos MIPRES aplicables, no para el estado operativo local.

## Reglas de negocio confirmadas

- Unidad mínima: `authorization_item`.
- Llave única: `numero_autorizacion + codigo_medicamento`.
- `codigo_medicamento` proviene de `COD_COMERCIAL`.
- `ESTADO_AUTORIZACION = 5` => `ENABLED`; cualquier otro valor => `BLOCKED_SOURCE_STATUS`.
- `normalizar(CUPS_PRINCIPAL) == "MEDICAMENTOS NO POS"` => `NO_PBS`.
- Cualquier otro valor normalizado de `CUPS_PRINCIPAL` => `PBS`.
- PBS no requiere consulta MIPRES para clasificación y usa `direction_status = NOT_APPLICABLE`.
- Solo `NO_PBS + ENABLED` entra a validación de direccionamiento MIPRES.
- Un direccionamiento MIPRES es vigente solo si `current_date(America/Bogota) < fecha_maxima`; igualdad con `fecha_maxima` no es válida.
- Medicarte registra la dispensación al cargar los soportes requeridos.
- El registro de Medicarte produce `DISPENSATION_REPORTED`; `DISPENSED` solo se produce tras `audit_status = APPROVED`.
- Los reportes operativos son diarios y cubren el día calendario anterior en `America/Bogota`.
- El destino de Google Drive para soportes es parametrizable y solo MTD Admin puede cambiarlo para cargas futuras.
- Tamaño máximo inicial por archivo: 20 MB.

## Prohibiciones

- No introducir una columna de “estado general” como fuente de verdad.
- No borrar eventos de auditoría ni versiones históricas de soportes.
- No enviar Gmail ni invocar MIPRES dentro de una transacción HTTP de negocio.
- No guardar tokens/secretos en frontend, logs o base de datos sin cifrado/gestor definido.
- No crear enlaces públicos de Drive.
- No duplicar enums o DTOs en web/api/worker: usar paquetes compartidos.
- No hacer acceso directo entre tablas de módulos ajenos cuando exista servicio/contrato de aplicación.
- No implementar decisiones `PENDING` ni completar por inferencia la parte abierta de decisiones `PARTIAL`.

## Ingeniería

- TypeScript strict.
- Contratos validados en runtime.
- Migraciones revisables y reversibles cuando sea técnicamente razonable.
- Idempotencia obligatoria para mutaciones críticas y jobs.
- Logs estructurados con correlation ID.
- Fechas persistidas en UTC y presentadas en `America/Bogota`.
- Pruebas unitarias para reglas puras, integración para DB/colas y E2E para historias verticales.

- Una llave existente solo puede actualizarse si `operation_status = READY_TO_DISPENSE`; queda bloqueada desde `DISPENSATION_REPORTED` en adelante.
- Una actualización explícita reemplaza la evidencia y reevalúa las cuatro columnas de negocio, manteniendo la pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL`; recalcula `operation_status`: solo `ENABLED + PBS + NOT_APPLICABLE` o `ENABLED + NO_PBS + CONFIRMED` conserva `READY_TO_DISPENSE`; cualquier otra combinación queda `BLOCKED`.
- Los reportes diarios se ejecutan a las 08:00 `America/Bogota` y cubren el día anterior.
- Los destinatarios son parametrizables y sus cambios se auditan.
- Solo una persona autorizada puede producir `audit_status = APPROVED`; no existe aprobación automática.
- Los soportes no tienen borrado automático por antigüedad.
- Las exportaciones CSV/XLSX son on-demand y no persistentes.
- Capacidad esperada: hasta 2.500 archivos por mes, máximo 20 MB por archivo.
- Despliegue esperado: Render; alternativa Google Cloud; región requerida Colombia.

- El producto vive en un repositorio nuevo e independiente de GitHub, estructurado como monorepo; no se integra en `vita-back` ni `vita-core`.

- Al entrar en `READY_TO_DISPENSE`, se notifica a OLP y Medicarte.
- Medicarte es el único actor operativo que define/modifica el punto de aplicación.
- La dirección de aplicación es un dato persistido, versionado y auditado; nunca existe solo en un correo.
- Asignar o cambiar el punto de aplicación notifica a OLP mediante outbox.
- La aplicación/registro de dispensación requiere `application_site_status = ASSIGNED`.
- `authorization_items` es un registro global único; su lectura multi-organización se controla con permisos y `authorization_item_organizations`, sin duplicarlo por empresa.
- En Fase 2 las cuatro columnas de negocio validadas son `NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `CUPS_PRINCIPAL` y `ESTADO_AUTORIZACION`; las demás columnas del archivo se conservan como evidencia sin reglas semánticas adicionales no documentadas.
