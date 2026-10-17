# Inasistencia, reprogramación y disposición del producto

**Corte de evidencia:** `develop` commit `97ade0b87f1a6e87730c89bf718169df41254155` (17-10-2026). **Clasificación:** `IMPLEMENTADO EN FUENTE` = código observado, no funcionalidad probada; `SIN FLUJO VERIFICADO` = no se identificó una operación específica entre controladores/contratos revisados; `REQUIERE DECISIÓN` = propuesta, no regla aprobada. **No se ejecutaron pruebas ni se accedió a producción.**

## Naturaleza de los registros

La **programación** de MEDICARTE es una intención; un evento **NOT_APPLIED** registra la no aplicación y puede afectar existencias si hubo un producto preparado que no se puede reutilizar; una aplicación confirmada es un hecho independiente. No inferir automáticamente que `CANCELLED` de agenda equivale a no asistencia ni que una reprogramación libera una reserva de la autorización.

| ID | Caso | Regla verificada y límites | Estado |
| --- | --- | --- | --- |
| CE-41 | Paciente no asiste | `POST /api/v1/medicarte/schedules/:scheduleId/not-applied`; novedad `PATIENT_NO_SHOW` con fecha y revisión de agenda | IMPLEMENTADO EN FUENTE |
| CE-42 | No aplicación por otra novedad | El contrato permite `INCORRECT_PRESCRIPTION`, `PRODUCT_NOT_CONTRACTED`, `AUTHORIZATION_CANCELLED`, `INSUFFICIENT_STOCK`, `RESCHEDULED` y `OTHER` | IMPLEMENTADO EN FUENTE |
| CE-43 | Medicamento no preparado | Disposición `NOT_PREPARED`, sin líneas de baja por no reutilización | IMPLEMENTADO EN FUENTE |
| CE-44 | Medicamento preparado pero reutilizable | `REUSABLE`: no registrar líneas `nonReusableLines`; existencia solo se libera o reasigna mediante la operación aplicable, no por inferencia documental | IMPLEMENTADO EN FUENTE / CONFIRMAR REGLA DE RESERVA |
| CE-45 | Medicamento preparado no reutilizable | `NON_REUSABLE` exige lote/unidades identificadas para producir movimientos de salida `NON_REUSABLE`; validaciones de cantidad, vencimiento y saldo | IMPLEMENTADO EN FUENTE |
| CE-46 | Reprogramar desde SCHEDULED o RESCHEDULED | `POST /api/v1/patient-schedules/:id/reschedule`; revisión `expectedRevision`; historial preservado; `CANCELLED` es terminal | IMPLEMENTADO EN FUENTE |
| CE-47 | Programación fuera de corte | `LATE` exige decisión `COMPLEMENTARY_PURCHASE_ORDER` o `NEXT_PERIOD`; esta última requiere período siguiente | IMPLEMENTADO EN FUENTE |
| CE-48 | No asistencia duplicada o aplicación ya confirmada en revisión | Bloqueos transaccionales por revisión y comprobación de aplicación confirmada; no duplicar egresos | IMPLEMENTADO EN FUENTE |

## Procedimiento recomendado para MEDICARTE

1. Localizar la programación, revisar autorización/producto, punto y `revision`.
2. Si **no se aplicó**, registrar la novedad real con fecha (`occurredOn`) y disposición (`NOT_PREPARED`, `REUSABLE`, `NON_REUSABLE`).
3. Para `NON_REUSABLE`, identificar cada `inventoryLotId` y cantidad; validar que no supere la cantidad programada ni saldo de lote. El repositorio inserta movimiento negativo de inventario y evento de auditoría.
4. Para cambiar fecha o punto, utilizar reprogramación con control de revisión; no manipular registros históricos de programación ni borrar atenciones.
5. Verificar la disponibilidad y reserva antes de reasignar físicamente un producto para otro paciente. El resultado de inasistencia **por sí solo** no garantiza liberación de toda reserva histórica.

## Casos que requieren aprobación de negocio

- Criterio de cuánto tiempo un preparado se conserva como `REUSABLE`; validación farmacéutica y cadena de custodia.
- Si la inasistencia debería liberar la reserva de una AUTO de manera automática. No se verificó esa equivalencia en los endpoints analizados.
- Cómo enlazar reprogramación tardía con OC complementaria y reservar unidades concretas: contrastar ciclo demand/OC, no generar OC por SQL.

**Código verificado:** `apps/api/src/outcomes/patient-outcome.{controller,repository}.ts`, `apps/api/src/scheduling/patient-schedule.{controller,service,repository}.ts`, `packages/contracts/src/index.ts` (novelties, disposition, transition, lateHandling).
