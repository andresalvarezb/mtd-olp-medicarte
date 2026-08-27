# SPEC-005 — Dispensación y soportes
**Fase:** 5

## Soportes
Tipos iniciales:
- fórmula;
- soporte de aplicación.

## Persistencia
`attachments` guarda `authorization_item_id`, `drive_file_id`, tipo, nombre, MIME, tamaño, hash, versión, actor, organización, fecha, estado antivirus, motivo de reemplazo y vigencia.

## Reglas de dispensación
- Medicarte ejecuta `dispensing.register` al cargar los soportes requeridos.
- El registro crea/persiste el hecho de dispensación y deja trazabilidad de actor y fecha.
- Después del registro, `operation_status = DISPENSATION_REPORTED`.
- `operation_status = DISPENSED` únicamente cuando la auditoría queda `APPROVED`.
- Un registro repetido debe ser idempotente y no crear dos dispensaciones.

## Reglas de soportes
- PDF inicial; validar contenido real.
- Tamaño máximo por archivo: 20 MB.
- Antivirus antes de `usable`.
- Nunca link público.
- Reemplazo crea versión nueva; no borra anterior.
- Descarga a través de API y autorización.
- El ID de Drive/carpeta destino es parametrizable.
- Solo MTD Admin puede cambiar el destino.
- El cambio aplica a cargas futuras; no mueve archivos históricos.
- Persistir junto al attachment la referencia suficiente al destino usado al cargarlo.
- Todo cambio de destino debe quedar auditado.
- No existe borrado automático por antigüedad de soportes.
- Los soportes permanecen en el Drive corporativo sin fecha máxima definida por la aplicación.

## Aceptación
Versionamiento correcto, acceso cruzado bloqueado, fallo Drive/DB conciliable, archivo malicioso/no PDF rechazado.
