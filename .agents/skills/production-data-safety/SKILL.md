---
name: production-data-safety
description: Prepara diagnósticos y propuestas de corrección controlada de datos productivos de Medicarte. Actívala ante una incidencia o ajuste de registros reales; no por SELECT explicativo, cambios de esquema versionados ni pruebas con datos sintéticos.
---

# Seguridad de datos productivos

**Entrada:** incidente, identificadores acotados, entorno, efecto esperado y responsable operativo. Si faltan, limitarse a un plan de diagnóstico sin conectar a producción.

1. Separar diagnóstico, propuesta, autorización, ejecución y verificación. Esta skill **no autoriza conectarse a producción ni ejecutar SQL de modificación**. La ejecución requiere autorización explícita y controles operativos externos, inmediatamente antes de actuar.
2. Inspeccionar contratos, relaciones, restricciones y pruebas del flujo afectado. Preparar consultas de prevalidación de solo lectura, con filtros por identificadores y organización, conteos esperados y evidencia minimizada. No ejecutar consultas productivas por la mera activación de esta skill.
3. Trazar dependencias: autorización, orden, recepción, reservas activas e históricas, inventario, consumo, estados y auditoría según el caso. Activar `purchase-fulfillment-integrity`, `financial-integrity`, `patient-master-integrity` o `rbac-point-scope` solo si cambia su frontera; `drizzle-schema-safety` corresponde a cambios estructurales versionados.
4. Si una corrección manual es apropiada, preparar SQL revisable con transacción, predicados específicos, condiciones previas verificables, conteos esperados y comprobaciones antes/después. Rechazar `UPDATE`/`DELETE` masivos sin delimitación y no sobrescribir historia inmutable. Definir reversión o compensación según la operación; no prometer rollback tras efectos externos.
5. Entregar la propuesta para revisión operativa: registros afectados, invariantes, consultas de lectura, SQL propuesto si procede, plan de verificación y de compensación, incertidumbres y autorización pendiente. No ejecutar desde una tarea de auditoría o validación de skills.

**Finaliza cuando:** el alcance y las cantidades son verificables, la trazabilidad histórica se preserva y la propuesta deja explícita la barrera de autorización. Si la evidencia no permite delimitar los registros, detener la corrección y pedir identificadores o decisión operativa.
