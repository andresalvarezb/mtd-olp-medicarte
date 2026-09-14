# ADR-033: ESP-009 stock transfers

## Decision

Stock transfers are logistical records independent of patients, authorizations and planning periods. A dispatch writes one negative `TRANSFER_OUT` movement per `stock_transfer_line`; a receive writes one positive `TRANSFER_IN` movement for the same line. The unique movement source key `(movement_type, source_type, source_id)` makes retries idempotent.

`DISPATCHED` is the in-transit state. It is represented by the transfer lines, not by an artificial dispensing point or inventory lot. On-hand and usable balances remain derived from `inventory_movements`; `inTransit` is reported separately and is never added to `usableBalance`.

Dispatch locks the transfer and source lots in deterministic ID order before validating the ledger balance. This serializes competing transfers against the same physical lot, so only available quantity can leave the source.

## Scope limitation

ESP-009 deliberately does not introduce an operator-to-dispensing-point scope model. MTD and Medicarte permissions therefore use the existing organization-level operational visibility. A point-specific operator scope must be designed in ESP-015 and must not be inferred from this feature.

No patient linkage, reservation, application, `RESERVED` balance, partial receipt, loss or damage is part of this model.
