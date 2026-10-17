# Brechas funcionales y decisiones requeridas después de documentar CE-33 a CE-84

**Corte de evidencia:** `develop` commit `97ade0b87f1a6e87730c89bf718169df41254155` (17-10-2026). **Clasificación:** `IMPLEMENTADO EN FUENTE` = código observado, no funcionalidad probada; `SIN FLUJO VERIFICADO` = no se identificó una operación específica entre controladores/contratos revisados; `REQUIERE DECISIÓN` = propuesta, no regla aprobada. **No se ejecutaron pruebas ni se accedió a producción.**

**Esta tabla no afirma que las funcionalidades existan ni que deban construirse sin validación de negocio.** Señala qué requiere decisión expresa y qué parte ya ofrece el código.

| Prioridad | ID | Proceso pendiente | Lo que ya existe | Requerimiento por definir / evidencia para cerrar |
| --- | --- | --- | --- | --- |
| P0 | RF-01 | Devolución posrecepción a OLP | Rechazo durante recepción legacy | Autorización RMA, movimiento compensatorio, inventario, proveedor y documento final |
| P0 | RF-02 | Novedad en tránsito por traslado | Transferencia CREATED→DISPATCHED→RECEIVED | Recibo parcial, faltantes, merma, reclamo y cierre sin inventario ficticio |
| P0 | RF-03 | Liberación de reserva por no-show y vencimiento | Novedad NOT_APPLIED; scheduler de invalidación | Momento, lote, reuso, reasignación y reglas de no doble consumo; **no presumir liberación** |
| P0 | RF-04 | Ajuste manual por daño/vencimiento fuera de atención | Movimiento NON_REUSABLE por resultado de atención | Tipos de ajuste, motivo, doble aprobación, evidencia y conciliación de stock |
| P1 | RF-05 | Reversión de recepción confirmada | Borrador editable, confirmación inmutable | Compensación auditable, control de OC asignadas, aplicación ya realizada |
| P1 | RF-06 | Conciliación contable/billing | Auditoría y analíticas económicas | Fuente factura, glosa, pagos, notas, impuestos, cortes y responsable |
| P1 | RF-07 | Seguimiento formal a fallas MIPRES externas | `QUERY_ERROR`, recheck y decisión manual NO PBS | Política de escalamiento, cadencia y requisitos de evidencia |
| P1 | RF-08 | Disposición reutilizable y preparación clínica | `REUSABLE` / `NON_REUSABLE` | Criterios farmacéuticos, caducidad después de preparado y segregación |
| P1 | RF-09 | Comprobación del RBAC por combinaciones | Role registry, permisos/puntos | Matriz operativa con actores reales, denegaciones y revocación concurrente |
| P2 | RF-10 | Evidencia de controles en producción | Endpoints, tests existentes, audit_events | Ejecutar casos TE y documentar resultados UAT por entorno/commit |

## Formato requerido para cerrar cada brecha

- Identificador de decisión, responsable MTD/OLP/MEDICARTE y aprobación.
- Evento disparador, estados previos/posteriores, cantidades, lote/punto y documentación de respaldo.
- Efecto en OC, AUTO, recepción, reserva, inventario y facturación, por separado.
- Permisos, concurrencia, idempotencia, auditoría, reversión y visibilidad.
- Casos de prueba positivos/negativos y evidencia anonimizada.

**No completar automáticamente RF-01 a RF-10 desde SQL manual.** Requieren especificación funcional y revisión de integridad.
