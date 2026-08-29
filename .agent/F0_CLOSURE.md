# Gate de Fase 0

**Estado del gate:** SATISFIED_WITH_BLOCKER

Fase 0 queda cerrada para Fases 1 y 2. Fase 3 permanece prohibida porque el contrato y acceso sandbox de MIPRES siguen `PENDING`. Este resultado cumple el gate F0: toda decision que afecta esquema, estados o permisos esta resuelta, y el unico contrato externo abierto tiene una prohibicion explicita de implementacion.

| Entregable                                  | Estado   | Evidencia                                                     | Restriccion                                               |
| ------------------------------------------- | -------- | ------------------------------------------------------------- | --------------------------------------------------------- |
| Repositorio independiente monorepo          | ACCEPTED | DEC-010, ADR-019 y estructura actual                          | No integrar en `vita-back`/`vita-core`.                   |
| Diccionario del archivo                     | ACCEPTED | `contracts/AUTHORIZATION_IMPORT_DATA_DICTIONARY.md`, SPEC-001 | Solo cuatro columnas tienen semantica F2.                 |
| Llave `NUMERO_AUTORIZACION + COD_COMERCIAL` | ACCEPTED | DEC-002, SPEC-001, SPEC-012                                   | No duplicar por organizacion.                             |
| Catalogo de causales                        | ACCEPTED | Contrato de datos y SPEC-001                                  | Codigos estables; no exponer excepciones.                 |
| Actualizacion de llave existente            | ACCEPTED | DEC-002                                                       | Revision humana; solo en `READY_TO_DISPENSE`.             |
| Contrato y sandbox MIPRES                   | PENDING  | `contracts/MIPRES_DIRECCIONAMIENTOS_SANDBOX.md`               | Prohibido implementar adaptador HTTP real de F3.          |
| Vigencia MIPRES                             | ACCEPTED | DEC-001, SPEC-003                                             | Comparacion estricta en `America/Bogota`.                 |
| Reporte diario                              | ACCEPTED | DEC-005, SPEC-004, ADR-006                                    | 08:00, dia anterior, destinatarios parametrizables.       |
| Drive, retencion y exportaciones            | ACCEPTED | DEC-007, ADR-005, ADR-018                                     | Sin enlaces publicos ni copia persistente de exportacion. |
| Auditoria humana                            | ACCEPTED | DEC-006, SPEC-006, ADR-016                                    | No existe aprobacion automatica.                          |
| Dispensacion reportada/aprobada             | ACCEPTED | DEC-003, DEC-004, ADR-009                                     | `DISPENSED` solo despues de `APPROVED`.                   |
| Capacidad inicial                           | ACCEPTED | DEC-008, SPEC-005                                             | 20 MB por archivo; 2.500/mes no es limite funcional.      |
| Despliegue                                  | ACCEPTED | DEC-009, ADR-017                                              | Produccion bloqueada si no se satisface region Colombia.  |
| Punto de aplicacion                         | ACCEPTED | DEC-011, SPEC-011, ADR-020                                    | Solo Medicarte modifica; historial y outbox.              |
| Alcance multi-organizacion                  | ACCEPTED | DEC-012, SPEC-012                                             | Item global unico y alcance backend explicito.            |

## Validacion del gate

- No quedan decisiones `PARTIAL`.
- DEC-001 a DEC-012 estan `ACCEPTED`.
- DEC-013 registra como `PENDING` el unico insumo externo ausente.
- No se autoriza trabajo funcional de Fase 3 mientras DEC-013 siga abierto.
- Fases posteriores tampoco pueden asumir el contrato MIPRES por inferencia.
