# Definition of Done

Una tarea no está terminada solo porque compila.

## Obligatorio
- Criterios de aceptación de la SPEC cubiertos.
- Tests relevantes verdes.
- Sin nuevas reglas de negocio no documentadas.
- OpenAPI actualizado si cambia un endpoint.
- Migración incluida si cambia persistencia.
- Auditoría añadida para mutaciones o accesos sensibles definidos.
- Autorización backend validada; ocultar botones no cuenta como seguridad.
- Idempotencia verificada cuando la operación pueda repetirse.
- Errores externos diferenciados de resultados de negocio.
- Logs sin secretos ni datos sensibles innecesarios.
- `pnpm lint`, typecheck y tests verdes.
- Documentación/ADR/SPEC actualizada cuando cambie contrato o decisión.
- Revisión por un agente distinto al implementador para tareas de riesgo medio/alto.

## Evidencia mínima en PR
- Spec/issue relacionada.
- Resumen de cambios.
- Tests ejecutados.
- Migraciones.
- Riesgos/concesiones.
- Capturas solo cuando aporten valor a UI.
