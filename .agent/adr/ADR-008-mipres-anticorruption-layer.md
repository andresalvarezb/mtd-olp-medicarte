# ADR-008 — Capa anticorrupción MIPRES

**Estado:** ACCEPTED

## Decisión

Todo acceso MIPRES pasa por `MipresPort`. El adaptador HTTP traduce contratos externos a modelos internos.

## Consecuencias

Los nombres/estados JSON de MIPRES no deben filtrarse al dominio. Los tests usan `MipresFakeAdapter` o fixtures de contrato.

La decisión arquitectónica no define el contrato externo. DEC-013 y `../contracts/MIPRES_DIRECCIONAMIENTOS_SANDBOX.md` permanecen `PENDING`; no se implementa el adaptador HTTP real por inferencia.
