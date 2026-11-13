# Puntos de partida financieros

- `docs/requirements/RF-MTD-CM-002-recaudo-devoluciones.md`: regla vigente de movimientos y conciliación.
- `docs/requirements/RF-MTD-RECAUDO-001-recaudo-unico-cuota-moderadora.md`: antecedente explícitamente superado en parte.
- `docs/requirements/AC-FIN-001-auditoria-financiera-alto-costo.md`: historial, auditoría y alcance.
- `apps/api/src/moderator-fee/authorization-moderator-fee.service.ts`: registro, proyección, bloqueo e idempotencia.
- `apps/api/src/moderator-fee/authorization-moderator-fee.service.test.ts`: casos de servicio.
- `apps/api/src/moderator-fee/moderator-fee-sheet.service.ts`: sincronización externa.
- `apps/api/src/exportables/exportables-moderator-fee.test.ts`: columnas financieras.
- `packages/contracts/src/moderator-fee.ts`: contrato de API.

Confirmar la regla exacta en código y pruebas actuales con `rg -n 'COLLECTED|REFUNDED|INVALIDATED|totalCollectedCop|totalRefundedCop' apps/api/src/moderator-fee`.
