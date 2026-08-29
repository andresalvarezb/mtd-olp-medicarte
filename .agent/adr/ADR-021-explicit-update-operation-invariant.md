# ADR-021 — Invariante operacional de actualización explícita

**Estado:** ACCEPTED

## Contexto

DEC-002 permite actualizar explícitamente una llave existente cuando su estado operacional actual es `READY_TO_DISPENSE`. La nueva fila puede cambiar `ESTADO_AUTORIZACION`, `CUPS_PRINCIPAL` y, por tanto, las dimensiones de habilitación, cobertura y direccionamiento. Conservar el estado operacional anterior podría dejar disponible un ítem que ya no cumple los prerrequisitos.

## Decisión

Una actualización explícita reemplaza la evidencia de origen y reevalúa las cuatro columnas de negocio de la fila aprobada: `NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `CUPS_PRINCIPAL` y `ESTADO_AUTORIZACION`. La pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL` debe coincidir con el ítem existente; por tanto, sus componentes de identidad no pueden cambiar mediante esta acción.

La precondición continúa siendo el estado actual `operation_status = READY_TO_DISPENSE`. Después de clasificar la nueva fila, la misma transacción deriva el estado operacional mediante una regla pura compartida:

```text
enablement_status = ENABLED
y (
  coverage_type = PBS y direction_status = NOT_APPLICABLE
  o
  coverage_type = NO_PBS y direction_status = CONFIRMED
)
    => operation_status = READY_TO_DISPENSE

cualquier otra combinación
    => operation_status = BLOCKED
```

En Fase 2, `NO_PBS + ENABLED` conserva `direction_status = PENDING` porque MIPRES todavía no se consulta. Por ello, una actualización a esa combinación queda `BLOCKED` hasta que la validación posterior de MIPRES confirme el direccionamiento. Fase 2 no realiza llamadas externas.

Las actualizaciones se rechazan desde `DISPENSATION_REPORTED` y `DISPENSED`, como ya establece DEC-002. La transición se persiste con control de versión, idempotencia y auditoría.

## Consecuencias

- Nunca se conserva `READY_TO_DISPENSE` cuando la nueva clasificación no cumple sus prerrequisitos.
- PostgreSQL protege el invariante para impedir que otra ruta de escritura persista `READY_TO_DISPENSE` con dimensiones incompatibles.
- `operation_status` sigue siendo una dimensión separada; no se introduce un estado general ni se persiste `process_summary`.
- La regla puede ser reutilizada por Fase 4 para la derivación de disponibilidad sin duplicar lógica.
- Una actualización que deja el ítem bloqueado no genera una nueva notificación de disponibilidad; las notificaciones de entrada a `READY_TO_DISPENSE` se mantienen event-driven y se definirán en Fase 4.
