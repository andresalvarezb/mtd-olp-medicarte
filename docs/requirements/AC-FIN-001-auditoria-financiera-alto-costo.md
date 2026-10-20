# AC-FIN-001 — Alcance MEDICARTE y auditoría financiera de alto costo

**Estado:** implementación local validada; pendiente integración Git y despliegue.
**Rama:** `feat/alto-costo-auditoria-financiero`.
**Fecha de validación:** 2026-10-19.
**Ámbito:** autorizaciones, MEDICARTE, MTD, recaudo de cuota moderadora, exportación XLSX y dashboard financiero.

## 1. Objetivo

Permitir el registro y consulta auditables del recaudo de cuota moderadora por ítem de autorización, mejorar el control de visibilidad de productos/puntos de MEDICARTE y disponer de información financiera de consulta y exportación.

El recaudo es un proceso financiero independiente. No constituye por sí mismo entrega, aplicación, recepción, asignación de inventario ni creación/modificación de una orden de compra.

## 2. Alcance implementado

### 2.1. Visibilidad MEDICARTE

La visibilidad operacional exige correspondencia del producto con el punto de dispensación, a partir del código comercial, datos válidos de expediente y presentación INVIMA del anexo tarifario activo y `product_delivery_point_mappings`.

La autorización debe estar relacionada operativamente con el punto por alguna de las fuentes admitidas:

- Programación activa.
- Punto habitual activo del paciente.
- Fuente vigente de orden de compra compatible.
- Asignación de inventario vinculada a la autorización.

Se verifica la organización propietaria del punto y el alcance del usuario. Para los actores con `pointAccessKind=explicit`, es obligatorio un permiso activo en `user_point_scopes`.

El registro financiero bloquea el ítem de autorización (`FOR UPDATE OF i`) y, cuando aplica alcance explícito, el permiso activo utilizado (`FOR SHARE OF ups`) hasta concluir la transacción.

### 2.2. Recaudo

El estado financiero vigente es el último evento por `version` de `authorization_moderator_fee_events`.

Estados:

- `NOT_RECORDED`: no existe evento histórico.
- `COLLECTED`: existe recaudo con importe positivo y fecha efectiva.
- `NOT_COLLECTED`: se registra ausencia de recaudo; importe y fecha son nulos.

El importe esperado se consulta de `authorization_items.source_data ->> 'VALOR_CUOTA_MODERADORA'`. Se conserva como dato de origen, separado del dinero efectivamente recaudado.

Cada registro o corrección crea un nuevo evento histórico. Los eventos anteriores no se actualizan ni eliminan.

El servicio exige:

- Clave UUID de idempotencia.
- Versión esperada (`expectedVersion`).
- Importe COP positivo con máximo dos decimales cuando el estado es `COLLECTED`.
- Fecha efectiva válida y no futura cuando hay recaudo.
- Observación de máximo 1000 caracteres.
- Referencia de máximo 255 caracteres.

El mismo intento idempotente no crea otro evento. Reutilizar la clave con contenido diferente genera conflicto.

Un reintento histórico idéntico puede devolver la proyección vigente, aunque esta tenga versiones posteriores al evento original. Esta semántica debe respetarse en consumidores y pruebas.

### 2.3. Autorización de operaciones

- MEDICARTE: consulta con `authorizations.read` y alcance operacional; sin permiso de registro.
- MTD: consulta con `authorizations.read`; registro con `moderator_fees.manage`.
- Otras organizaciones: sin acceso a estas operaciones de recaudo.

Los controles se aplican en backend. Ocultar o mostrar un formulario no sustituye la autorización del servidor.

### 2.4. API

Con prefijo global `/api/v1`:

| Método | Ruta | Propósito |
| --- | --- | --- |
| GET | `/medicarte/authorizations/:id/moderator-fee` | Consultar estado e historial |
| POST | `/medicarte/authorizations/:id/moderator-fee` | Registrar nuevo evento de recaudo |
| GET | `/analytics/dashboard/financial-audit` | Consultar indicadores financieros desde MTD |

Las operaciones requieren autenticación y contexto de organización. El dashboard financiero requiere las autorizaciones específicas de analítica económica y lectura de auditorías de aplicación; verificar el controlador antes de modificar los permisos.

El contrato de recaudo está definido en `packages/contracts/src/moderator-fee.ts`.

### 2.5. Interfaz y exportación

- La consulta de autorizaciones incluye el panel de recaudo, estado vigente, importe esperado, valor efectivamente recaudado e historial.
- El formulario de registro y corrección se muestra únicamente cuando el usuario puede gestionar el recaudo.
- Resumen y Entrega / Aplicación muestran valor de cuota, total recaudado y pendiente calculado desde el último estado, sin sumar versiones históricas.
- El formulario muestra el importe explícito (igual a la cuota completa) y una fecha sin hora. La fecha se almacena como el inicio del día en Colombia, manteniendo el contrato `collectedAt` con zona horaria.
- No se permiten abonos parciales: la API exige que `amountCop` coincida exactamente con el importe autoritativo. Si se requiere pago parcial, hace falta una especificación y cambios de negocio/backend independientes.
- MEDICARTE conserva la tarjeta informativa de solo lectura dentro de Entrega / Aplicación, sin controles para registrar recaudo.
- El dashboard MTD incorpora una sección de auditoría financiera.
- El exportador XLSX de autorizaciones incorpora columnas financieras y obtiene el último evento por autorización, sin multiplicar registros por el historial.

Los indicadores agregados de recaudo contabilizan el último estado por autorización, no la suma de todos los eventos históricos.

Las verificaciones de cumplimiento de auditoría de facturación se mantienen separadas de los registros de recaudo. El dashboard no constituye por sí solo un cierre contable.

## 3. Persistencia

Migración: `0102_authorization_moderator_fee_events.sql`.

Tabla: `authorization_moderator_fee_events`.

Campos principales:

- `authorization_item_id`
- `version`
- `status`
- `amount_cop`
- `collected_at`
- `observation`
- `reference`
- `registered_by`
- `organization_id`
- `correlation_id`
- `idempotency_key`
- `created_at`

Restricciones:

- Clave única `(authorization_item_id, version)`.
- Clave única `(authorization_item_id, idempotency_key)`.
- Validación de estado, importe, fecha, referencia y observación.
- Trigger `trg_moderator_fee_event_immutability` contra UPDATE y DELETE.
- Índice histórico para obtener la última versión.

El registro del evento y la escritura de `audit_events` se ejecutan dentro de la misma transacción PostgreSQL. Ante un error de auditoría, el registro de recaudo se revierte.

**Consistencia del índice:** la migración SQL y el esquema Drizzle declaran el índice histórico sobre `(authorization_item_id, version DESC)`. La definición fue contrastada con PostgreSQL 17 en integración.

## 4. Evidencia de verificación

### Validaciones de aplicación

- TypeScript global: PASS.
- ESLint global: PASS.
- Suite global `pnpm test`: PASS.
- Compilación global `pnpm build`: PASS.
- Next.js 16.3.3 con Turbopack: PASS, incluida compilación limpia e incremental.
- Catálogo estático de base de datos: PASS, 14 archivos.
- Integridad `git diff --check`: PASS.

### PostgreSQL real

Ambiente: PostgreSQL 17, base aislada `authorization_test_integration`.

- Migraciones 0000–0102: ejecución satisfactoria.
- Validación de esquema, índices y restricciones: PASS.
- Ejecución SQL de alcance MEDICARTE con bloqueo de permiso: PASS.
- Concurrencia registro/revocación: PASS.
- Restricciones financieras e inmutabilidad: PASS.
- Historial y consulta de último evento: PASS.
- Servicio real, versiones e idempotencia: PASS.
- Persistencia con COMMIT real: PASS.
- Reversión ante fallo de auditoría: PASS.
- Datos sintéticos residuales después de limpieza y ROLLBACK: 0.

La prueba de COMMIT real utilizó una base temporal clonada, eliminada después de la validación.

## 5. Limitaciones y pendientes

- No se ha aplicado la migración `0102` en producción.
- No se ha realizado despliegue.
- No se ha ejecutado en este cierre una prueba HTTP extremo a extremo autenticada con actores operativos reales.
- Los escenarios PostgreSQL fueron verificados en entornos aislados; no sustituyen las pruebas de despliegue.
- Debe realizarse revisión final del diff y documentarse el SHA del commit al publicar.
- Debe revisarse la alineación entre el índice descendente SQL y Drizzle.

## 6. Archivos de referencia

- `apps/api/src/moderator-fee/`
- `apps/api/src/common/medicarte-product-point-scope.ts`
- `apps/api/src/analytics/`
- `apps/api/src/exportables/`
- `apps/web/features/authorizations/authorization-moderator-fee-panel.tsx`
- `apps/web/features/dashboard/financial-audit-dashboard-section.tsx`
- `packages/contracts/src/moderator-fee.ts`
- `packages/database/migrations/0102_authorization_moderator_fee_events.sql`
- `packages/database/src/schema.ts`

## 7. Condiciones para despliegue

Antes de desplegar:

1. Integrar y revisar el commit de la rama.
2. Confirmar variables, permisos y versión de PostgreSQL del entorno objetivo.
3. Aplicar la migración mediante el procedimiento controlado del repositorio.
4. Verificar el historial de migraciones en el entorno objetivo.
5. Ejecutar pruebas HTTP autenticadas para MEDICARTE y MTD.
6. Validar consulta, recaudo, historial, XLSX y dashboard.
7. Confirmar que la operación financiera no altera OC, recepción, stock ni fulfillment.

No confundir la validación local de este documento con certificación de producción.
