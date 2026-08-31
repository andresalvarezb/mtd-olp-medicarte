# ADR-021 — Invariante operacional de actualización explícita

**Estado:** ACCEPTED

## Contexto

DEC-002 permite actualizar explícitamente una llave existente cuando su estado operacional actual es `LISTO_PARA_DISPENSAR`. La nueva fila puede cambiar `ESTADO_AUTORIZACION`, `No.PRESCRIPCION` y, por tanto, las dimensiones de habilitación, cobertura y direccionamiento. Conservar el estado operacional anterior podría dejar disponible un ítem que ya no cumple los prerrequisitos.

## Decisión

Una actualización explícita reemplaza la evidencia de origen y reevalúa las cuatro columnas de negocio de la fila aprobada: `NUMERO_AUTORIZACION`, `COD_COMERCIAL`, `ESTADO_AUTORIZACION` y `No.PRESCRIPCION`. La cobertura se clasifica por presencia del número de prescripción conforme a DEC-016. La pareja normalizada `NUMERO_AUTORIZACION + COD_COMERCIAL` debe coincidir con el ítem existente; por tanto, sus componentes de identidad no pueden cambiar mediante esta acción.

La precondición continúa siendo el estado actual `operation_status = LISTO_PARA_DISPENSAR`. Después de clasificar la nueva fila, la misma transacción deriva el estado operacional mediante una regla pura compartida:

```text
enablement_status = HABILITADO
y (
  coverage_type = PBS y direction_status = NO_APLICA
  o
  coverage_type = NO_PBS y direction_status = CONFIRMADO
)
    => operation_status = LISTO_PARA_DISPENSAR

cualquier otra combinación
    => operation_status = BLOQUEADO
```

En Fase 2, `NO_PBS + HABILITADO` conserva `direction_status = PENDIENTE` porque MIPRES todavía no se consulta. Por ello, una actualización a esa combinación queda `BLOQUEADO` hasta que la validación posterior de MIPRES confirme el direccionamiento. Fase 2 no realiza llamadas externas.

Las actualizaciones se rechazan desde `DISPENSACION_REPORTADA` y `DISPENSADO`, como ya establece DEC-002. La transición se persiste con control de versión, idempotencia y auditoría.

## Consecuencias

- Nunca se conserva `LISTO_PARA_DISPENSAR` cuando la nueva clasificación no cumple sus prerrequisitos.
- PostgreSQL protege el invariante para impedir que otra ruta de escritura persista `LISTO_PARA_DISPENSAR` con dimensiones incompatibles.
- `operation_status` sigue siendo una dimensión separada; no se introduce un estado general ni se persiste `process_summary`.
- La regla puede ser reutilizada por Fase 4 para la derivación de disponibilidad sin duplicar lógica.
- Una actualización que deja el ítem bloqueado no genera una nueva notificación de disponibilidad; las notificaciones de entrada a `LISTO_PARA_DISPENSAR` se mantienen event-driven y se definirán en Fase 4.
