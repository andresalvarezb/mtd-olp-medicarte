# Gate de Fase 0

**Estado del gate:** SATISFIED

Fase 0 queda cerrada sin bloqueos. DEC-013 se resolvió con el contrato de lectura `WSSUMMIPRESNOPBS` aceptado en `contracts/MIPRES_DIRECCIONAMIENTOS_CONTRATO.md`, lo que autoriza el alcance de Fase 3 definido en el contrato y SPEC-003. El diseño de Fases 4 a 6 queda cerrado por DEC-015 y la regla de que ambas fechas habilitan revisión humana sin aprobar automáticamente.

| Entregable                                  | Estado   | Evidencia                                                     | Restriccion                                                                    |
| ------------------------------------------- | -------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Repositorio independiente monorepo          | ACCEPTED | DEC-010, ADR-019 y estructura actual                          | No integrar en `vita-back`/`vita-core`.                                        |
| Diccionario del archivo                     | ACCEPTED | `contracts/AUTHORIZATION_IMPORT_DATA_DICTIONARY.md`, SPEC-001 | 26 columnas; negocio: llave, `ESTADO_AUTORIZACION`, `No.PRESCRIPCION`.         |
| Llave `NUMERO_AUTORIZACION + COD_COMERCIAL` | ACCEPTED | DEC-002, SPEC-001, SPEC-012                                   | No duplicar por organizacion.                                                  |
| Catalogo de causales                        | ACCEPTED | Contrato de datos y SPEC-001                                  | Codigos estables; no exponer excepciones.                                      |
| Actualizacion de llave existente            | ACCEPTED | DEC-002, DEC-014, ADR-021                                     | Revision humana; solo en `READY_TO_DISPENSE`; recalcula el estado operacional. |
| Contrato MIPRES direccionamientos           | ACCEPTED | DEC-013, `contracts/MIPRES_DIRECCIONAMIENTOS_CONTRATO.md`     | Solo lectura; `No.PRESCRIPCION` menos sus ultimos 3 digitos (DEC-016).         |
| Vigencia MIPRES                             | ACCEPTED | DEC-001, SPEC-003                                             | Comparacion estricta en `America/Bogota`.                                      |
| Reporte diario                              | ACCEPTED | DEC-005, SPEC-004, ADR-006                                    | 08:00, dia anterior, destinatarios parametrizables.                            |
| Drive externo y exportaciones               | ACCEPTED | DEC-007, ADR-005, ADR-018                                     | Sin attachments en la aplicacion ni copia persistente de exportacion.          |
| Auditoria humana                            | ACCEPTED | DEC-006, SPEC-006, ADR-009, ADR-016                           | No existe aprobacion ni completitud automatica.                                |
| Dispensacion reportada/aprobada             | ACCEPTED | DEC-003, DEC-004, ADR-009                                     | OLP reporta fecha; `DISPENSED` solo despues de `APPROVED`.                     |
| Capacidad inicial                           | ACCEPTED | DEC-008, SPEC-013                                             | 20 MB por importacion/bulk; soportes no ingresan a la aplicacion.              |
| Despliegue                                  | ACCEPTED | DEC-009, ADR-017                                              | Region de produccion aprobada: Virginia, USA; Colombia no es requisito.        |
| Lugar de dispensacion                       | ACCEPTED | DEC-011, SPEC-011, ADR-020                                    | Solo Medicarte modifica masivamente; historial y outbox.                       |
| Bulk updates operativos                     | ACCEPTED | DEC-015, SPEC-013, ADR-022                                    | Pipeline tipado, llave + un campo, permiso backend por fila.                   |
| Fechas para iniciar auditoria               | ACCEPTED | DEC-015, SPEC-002, SPEC-006                                   | Ambas fechas producen READY; nunca APPROVED automatico.                        |
| Alcance multi-organizacion                  | ACCEPTED | DEC-012, SPEC-012                                             | Item global unico y alcance backend explicito.                                 |

## Validacion del gate

- No quedan decisiones `PARTIAL`.
- Todas las decisiones (DEC-001 a DEC-016) estan `ACCEPTED`.
- Ninguna decision permanece `PENDING`.
- Fase 3 queda autorizada con el alcance de solo lectura del contrato aceptado.
