# SPEC-007 — Handoff al scraper de admisiones

**Fase:** 7

## Entrada

Solo registros derivados como `READY_FOR_ADMISSION`.

## Modelo

`admission_jobs` con idempotency key, estado, lease owner, lease expiry, intentos, resultado y referencias externas.

## Flujo

`READY -> HANDED_OFF -> COMPLETED|ERROR`, con recuperación de lease expirado.

## Reglas

- Claim atómico.
- Un consumidor no puede crear dos admisiones para la misma clave idempotente.
- Un fallo del scraper no des-aprueba el ítem.
- Conciliación explícita de trabajos inciertos.

## Aceptación

Doble consumo no duplica; lease abandonado se recupera; reintentos quedan trazados.
