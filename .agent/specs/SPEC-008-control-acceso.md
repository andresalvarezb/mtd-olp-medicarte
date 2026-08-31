# SPEC-008 — Organizaciones, roles y permisos

**Fase:** 1 y transversal

## Matriz confirmada

| Capacidad                         | MEDICARTE | OLP                              | MTD                                      |
| --------------------------------- | --------- | -------------------------------- | ---------------------------------------- |
| Consultar registros relacionados  | Sí        | Sí                               | Según rol; lectura global cuando aplique |
| Descargar base completa permitida | Sí        | Sí, incluye `lugar_dispensacion` | Según rol                                |
| Bulk `lugar_dispensacion`         | Sí        | No                               | No                                       |
| Bulk `fecha_dispensacion`         | No        | Sí                               | No                                       |
| Bulk `fecha_aplicacion`           | Sí        | No                               | No                                       |
| Auditar soportes/decidir          | No        | No                               | Auditor autorizado                       |
| Administrar configuración Drive   | No        | No                               | MTD Admin                                |

Compensar conserva lectura de autorizaciones y consolidado solo con permiso explícito. MTD mantiene administración y auditoría según rol, pero no suplanta las cargas operativas exclusivas de OLP o MEDICARTE. Una corrección excepcional por MTD requeriría una decisión y permiso futuros explícitos.

## Permisos atómicos

- `authorizations.read`
- `authorizations.read_sensitive`
- `operational_exports.create`
- `bulk_updates.dispensation_location`
- `bulk_updates.dispensation_date`
- `bulk_updates.application_date`
- `bulk_updates.read`
- `audit.start`, `audit.approve`, `audit.reject`
- `drive_config.manage`

Se eliminan del alcance `attachments.upload`, `attachments.read`, `dispensing.register` y `application_site.assign` como permisos funcionales del nuevo proceso. Una migración futura deberá retirar seeds obsoletos sin reinterpretarlos.

## Regla

Cada request, lote, fila, replay y descarga aplica permiso + organización + relación del recurso en backend. La UI solo refleja autorización. El tipo de bulk determina una columna fija; poseer permiso para un tipo nunca habilita otras columnas.

## Tests obligatorios

- acceso horizontal y elevación vertical;
- usuario suspendido y multi-organización;
- lectura sensible/redacción en exportación;
- MEDICARTE intentando fecha de dispensación;
- OLP intentando lugar o fecha de aplicación;
- columnas extra o tipo manipulado;
- consulta/replay de lote por otra organización;
- actor no auditor intentando aprobar.
