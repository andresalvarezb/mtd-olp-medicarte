# Mapa de base de datos — MTD / OLP / MEDICARTE

> Referencia de lectura rápida para desarrollo, análisis funcional, auditoría y agentes de código.
> **Corte verificado en origen:** `develop` @ `abdf41106a151862b27668180e37c0499101634d` (2026-10-17).
> **Fuente de verdad de diseño:** [`packages/database/src/schema.ts`](../../packages/database/src/schema.ts) y [`packages/database/migrations/`](../../packages/database/migrations/).
> **Fuente de verdad de cada ambiente:** catálogo de PostgreSQL **y** migraciones realmente aplicadas. Un esquema Drizzle no demuestra el estado de producción.

## Respuesta rápida: ¿dónde está cada cosa?

| Necesidad | Tabla(s) de entrada | Continuar en |
| --- | --- | --- |
| Usuario, roles, empresa, permisos | `users`, `user_organization_roles`, `role_permissions` | `organizations`, `roles`, `permissions`, `role_organization_scopes` |
| Autorización, medicamento, PBS / MIPRES | `authorization_items` | `mipres_checks`, `mipres_directions`, `authorization_mipres_decision_history` |
| Programación de MEDICARTE | `patient_schedules` | `patient_schedule_history`, `planning_periods`, `dispensing_points` |
| Demanda estimada | `projected_demand_lines` | `demand_sources`, `planning_periods` |
| OC y cantidad solicitada | `purchase_orders`, `purchase_order_lines` | `purchase_order_authorization_sources`, `purchase_order_demand_allocations` |
| Aceptación, entregas OLP | `purchase_orders`, `deliveries`, `delivery_lines` | `purchase_order_lines` |
| Recepción directa de OC | `purchase_order_receipts`, `purchase_order_receipt_lines` | `purchase_order_lines` |
| Recepción ligada a entrega (lotes) | `receipts`, `receipt_lines` | `deliveries`, `delivery_lines`, `inventory_lots` |
| Lotes y existencias físicas | `inventory_lots`, `inventory_movements` | `inventory_locations`, `dispensing_points` |
| Reserva para una autorización | `inventory_authorization_allocations` | `authorization_items`, `purchase_orders`, `dispensing_points` |
| Entrega/aplicación confirmada | `authorization_fulfillments`, `authorization_fulfillment_lines` | `inventory_authorization_allocations`, `inventory_lots` |
| Reprogramación/inasistencia | `patient_schedule_history`, `patient_schedule_outcomes` | `patient_schedule_outcome_lines` |
| Auditoría de facturación | `authorization_billing_audits` | `authorization_billing_audit_evidence` |
| Incidencias conciliación | `reconciliation_issues`, `reconciliation_findings` | `reconciliation_runs`, `reconciliation_issue_events` |

La relación **OC ≠ recibido ≠ reserva ≠ consumo** es crítica. Consultar [mapa operativo](mapa-operativo.md) antes de formular consultas que suman cantidades.

## Referencias disponibles

- [Mapa operativo y diagramas Mermaid](mapa-operativo.md): recorridos principales y relaciones FK verificadas en Drizzle.
- [Consultas de metadatos SQL](consultas-metadatos.sql): lectura de tablas, columnas, claves, índices y checks **sin acceder a datos de pacientes**.
- `catalogo-generado.md` (**generado**): diccionario completo de columnas, PK, FK, checks e índices definidos en Drizzle.
- `schema-index.json` (**generado**): índice ligero y estructurado para herramientas/agentes.
- `diagramas/*.mmd` (**generados**): diagramas separados por dominios, para evitar un ERD de 87 tablas ilegible.

## Generar y consultar en Git Bash

Desde la raíz del repositorio, con dependencias instaladas (`pnpm install --frozen-lockfile`):

```bash
# Actualiza catálogo, índice y diagramas desde el schema.ts actual.
node scripts/db-schema-catalog.mjs --generate

# Verifica que la documentación generada coincida con el código.
node scripts/db-schema-catalog.mjs --check

# Encuentra una tabla, la lista de columnas y FK entrantes/salientes.
node scripts/db-schema-catalog.mjs --table purchase_orders

# Localiza por tabla o por nombre de columna.
node scripts/db-schema-catalog.mjs --search authorization

# Inventario de un dominio concreto.
node scripts/db-schema-catalog.mjs --module inventario
```

Los grupos admitidos son `identidad`, `autorizaciones`, `planeacion`, `compras`, `recepciones`, `inventario`, `atencion`, `tarifas`, `auditoria`, `conciliacion`, `cargas` y `otros`.

## Verificar el esquema realmente aplicado en PostgreSQL (opcional)

La comparación real requiere acceso **autorizado** a un ambiente de desarrollo/integración. El script utiliza una transacción **READ ONLY** y consulta solo `information_schema.columns`, sin seleccionar filas de negocio:

```bash
# DATABASE_URL debe estar configurada en el entorno (no pegar credenciales en el chat).
node scripts/db-schema-catalog.mjs --compare-live
```

El resultado señala tablas o columnas ausentes respecto de Drizzle. No sustituye una verificación de tipos, claves foráneas, constraints, triggers, RLS, migraciones ni datos; tampoco interpreta por sí solo una diferencia como error.

## Política de mantenimiento

1. Si cambia `packages/database/src/schema.ts`, ejecutar `--generate` y `--check` y versionar los archivos generados junto con la modificación.
2. Si cambia una migración sin cambio de Drizzle, contrastar la BD efectiva y actualizar el mapa operativo si cambió el significado del proceso; el catálogo estático no puede detectarlo solo.
3. Si un campo es histórico/de compatibilidad, no asumir que sea autoritativo: identificar su repositorio y flujo de escritura real.
4. Para un requerimiento o bug, empezar con `--table` o `--search`, seguir las FK del catálogo y contrastar con `apps/api/src/<dominio>/*.repository.ts`, servicios, contratos y pruebas. **Las FK no son un grafo de llamadas ni una especificación de comportamiento.**
5. Mantener las consultas de diagnóstico en desarrollo/integración; no subir exportaciones reales de pacientes, contraseñas, tokens ni dumps al repositorio.

### Atajo de trabajo para agentes

> Antes de buscar por todo el repositorio, lee `docs/base-de-datos/README.md`, busca la entidad en `schema-index.json` (o ejecuta `node scripts/db-schema-catalog.mjs --table <tabla>`), revisa las relaciones y sus columnas clave y **solo entonces** inspecciona el servicio/repositorio y los tests correspondientes. Si `--check` falla, regenera antes de confiar en el catálogo. No infieras disponibilidad física a partir de cantidades de OC.

**Limitación:** durante la creación inicial se inspeccionó estáticamente el schema de `develop`, con **87 tablas Drizzle**. No se accedió a una instancia de PostgreSQL para afirmar cuántas tablas existen realmente en producción o qué migraciones están aplicadas allí.
