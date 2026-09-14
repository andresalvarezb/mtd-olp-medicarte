# ADR-032: ESP-008 inventory ledger

## Decisión

El inventario operacional se deriva de `inventory_movements`; no existe un
saldo mutable. La única entrada inicial es un movimiento `RECEIPT` positivo
por cada `receipt_line` con una recepción `CONFIRMED` y `accepted_quantity > 0`.

La confirmación de una recepción y la creación del lote/movimiento ocurren en
la misma transacción y bajo el bloqueo de la recepción. No existe un outbox
transaccional fiable en esta versión, por lo que no se usa publicación BullMQ.
La unicidad `(movement_type, source_type, source_id)` hace idempotentes retries y
concurrencia.

El lote usa el snapshot observado por Medicarte: código/punto de la delivery y
lote/vencimiento recibidos. La propiedad económica es MTD y la custodia física
es Medicarte. No hay reserva ni enlace a pacientes.

## Consecuencias

`physical_balance` es la suma de todos los movimientos. `usable_balance` es cero
si el vencimiento ya pasó y, de otro modo, la misma suma. No se generan bajas
automáticas por vencimiento. FEFO solo recomienda el vencimiento más próximo;
la selección para paciente pertenece a ESP-010.
