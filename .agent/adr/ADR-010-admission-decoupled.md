# ADR-010 — Scraper de admisiones desacoplado

**Estado:** ACCEPTED

## Decisión

El núcleo entrega registros `READY_FOR_ADMISSION` mediante contrato versionado. El scraper reclama trabajos con lease y reporta resultados.

## Consecuencia

La caída o reejecución del scraper no debe cambiar la aprobación ni crear admisiones duplicadas.
