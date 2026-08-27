# SPEC-001 — Importación de autorizaciones
**Fase:** 2

## Objetivo
Cargar CSV/XLSX de forma idempotente, conservar evidencia por fila y confirmar ítems válidos.

## Entrada mínima conocida
- `NUMERO_AUTORIZACION`
- `COD_COMERCIAL`
- `CUPS_PRINCIPAL`
- `ESTADO_AUTORIZACION`
- `No.PRESCRIPCION` cuando exista

## Reglas
- `authorization_key = normalizar(NUMERO_AUTORIZACION) + normalizar(COD_COMERCIAL)`.
- `COD_COMERCIAL` alimenta `codigo_medicamento`.
- Un duplicado dentro del archivo no crea dos ítems.
- Si la llave ya existe, la fila se reporta para verificación humana y no se actualiza automáticamente.
- Debe existir una acción explícita de actualización.
- Solo se habilita si `operation_status = READY_TO_DISPENSE`.
- Se bloquea para `DISPENSATION_REPORTED`, `DISPENSED` y estados posteriores.
- Los mensajes de excepción técnicos no son causales de negocio.

## Flujo
`UPLOADED -> VALIDATING -> READY_TO_CONFIRM -> CONFIRMING -> COMPLETED`.
Excepciones: `FAILED`, `CANCELLED`.

## Persistencia
`import_batches`, `import_rows`, `validation_errors`, `authorization_items`, `audit_events`.

## Aceptación
- misma carga repetida no duplica;
- concurrencia sobre la misma llave no duplica;
- cada fila tiene código de resultado estable;
- se puede consultar progreso y reporte paginado;
- confirmación es transaccional.

