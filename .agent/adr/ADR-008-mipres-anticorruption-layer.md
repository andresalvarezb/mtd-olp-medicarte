# ADR-008 — Capa anticorrupción MIPRES

**Estado:** ACCEPTED

## Decisión

Todo acceso MIPRES pasa por `MipresPort`. El adaptador HTTP traduce contratos externos a modelos internos.

## Consecuencias

Los nombres/estados JSON de MIPRES no deben filtrarse al dominio. Los tests usan `MipresFakeAdapter` o fixtures de contrato.

El contrato externo quedó cerrado con DEC-013 (`../contracts/MIPRES_DIRECCIONAMIENTOS_CONTRATO.md`): servicio `WSSUMMIPRESNOPBS`, endpoints `GenerarToken` y `DireccionamientoXPrescripcion`, token operativo gestionado por `MipresTokenProvider` y solo lectura. `MipresHttpAdapter` ya puede implementarse contra ese contrato.
