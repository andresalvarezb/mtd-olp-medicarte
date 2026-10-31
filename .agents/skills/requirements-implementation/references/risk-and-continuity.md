# Riesgo, fixtures y continuidad

Consultar solo para cambios de alto riesgo, integración real o tareas prolongadas.

## Antes de editar: prueba mínima según impacto

| Impacto detectado                     | Evidencia mínima esperada                                                          |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| UI o lógica local                     | Prueba de componente/función y validación estática focalizada                      |
| Roles, puntos, organizaciones         | Casos autorizados y denegados; scope por id y listado                              |
| Esquema o migraciones                 | Compatibilidad, constraints y migración en base TEST aislada                       |
| Inventario, cantidades o transiciones | Fixtures de saldos y estados, positivos/negativos, no regresión                    |
| Dinero, idempotencia o concurrencia   | Monto exacto, duplicados/reintentos, rollback, auditoría y carrera real en DB TEST |

Reusar scripts TEST existentes antes de crear infraestructura nueva. Fixtures solo sintéticos, deterministas y repetibles; no reutilizar datos productivos. No ampliar a pruebas costosas sin justificar el riesgo. Mantener evidencia fresca para concurrencia y migraciones.

## Checkpoint local por hito o interrupción

Guardar en `.codex/work-progress/<ID>.md` únicamente después de confirmar su exclusión con `git check-ignore -q .codex/work-progress/<ID>.md`. Si no está ignorado, registrar `.codex/work-progress/` en `.git/info/exclude` (solo configuración local). No copiar secretos, registros clínicos, volcados ni salidas extensas.

```markdown
# <ID> — progreso local

- Rama / HEAD / cambios no confirmados:
- Decisiones aprobadas y bloqueos:
- Criterios → rutas revisadas / modificadas:
- Pruebas ejecutadas (comando, resultado, fecha):
- Pendientes y próximo paso único:
```

Al reanudar, comprobar Git, archivos y validez de las pruebas. El checkpoint es orientación, no prueba de que el código actual siga correcto. No escribirlo para tareas triviales ni en cada comando.
