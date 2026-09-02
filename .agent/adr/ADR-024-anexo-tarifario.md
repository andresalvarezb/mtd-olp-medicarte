# ADR-024 — Anexo Tarifario como prerrequisito de `READY_TO_DISPENSE`

**Estado:** ACCEPTED

## Contexto

El Anexo Tarifario es el catálogo administrativo, gestionado exclusivamente por MTD, de los códigos de producto habilitados para el proceso. La llave de cruce es la ya definida por el contrato vigente: `authorization_items.codigo_medicamento` (proveniente de `COD_COMERCIAL`, normalizado con la misma regla técnica de la llave de negocio) contra `tariff_annex_products.codigo_producto`. No se crean llaves alternativas ni se usan CUM, CUPS, descripción o principio activo para decidir pertenencia.

## Decisión

1. **Nueva dimensión de validación por ítem.** `authorization_items` persiste el resultado de la validación del Anexo en `tariff_membership_status` (`NOT_EVALUATED | LISTED | NOT_LISTED`) con timestamp y versión de regla (`TARIFF-ANNEX-1`). No se colapsa en un campo genérico de validez (ADR-009: estados ortogonales).
2. **Regla central actualizada.** `deriveOperationStatus()` (paquete dominio) exige `productInTariffAnnex = true` además de habilitación, cobertura y direccionamiento. La regla se reutiliza en las tres rutas de materialización existentes: confirmación de importación, reprocesamiento MIPRES y actualización explícita de evidencia. El invariante de PostgreSQL (`authorization_items_ready_prerequisites_check`) se extiende en consecuencia: ninguna ruta de escritura puede persistir `READY_TO_DISPENSE` con un producto fuera del Anexo.
3. **Causal estable.** `PRODUCT_NOT_IN_TARIFF_ANNEX` ("Producto no incluido en el Anexo Tarifario") es derivable de `tariff_membership_status = NOT_LISTED` para bandejas, filtros, reportes, exportaciones y auditoría. Un registro puede acumular varias causales simultáneas (`deriveEpsNovedadCausales`); las causales no se reducen a un único rechazo genérico.
4. **Ítems conservados.** Una autorización cuyo producto no está en el Anexo se persiste igualmente (`operation_status = BLOCKED`, membresía `NOT_LISTED`); no se elimina ni se omite. Queda disponible para revalidación posterior y visible en la base de novedades EPS.
5. **Persistencia del catálogo.** Tabla `tariff_annex_products` con unicidad sobre el código normalizado, `active` como desactivación lógica (nunca eliminación física: preserva trazabilidad y evidencia histórica), versión incremental, actor y organización. PostgreSQL es la única fuente de verdad (ADR-003). El cargue masivo reutiliza el patrón de staging (fuente `BYTEA` temporal, resultado por fila, idempotencia).
6. **Revalidación event-driven.** Crear o reactivar un producto emite, en la misma transacción, el evento outbox `tariff.product.activated` con idempotencia por versión de producto. El dispatcher lo entrega a la cola BullMQ `tariff-annex` y el worker ejecuta la revalidación dirigida: únicamente ítems con `codigo_medicamento = codigo_producto` y `tariff_membership_status = 'NOT_LISTED'` (selección indexada). Por cada ítem se resuelve la causal, se re-ejecuta la función central de dominio con todas las dimensiones vigentes y, si hay transición real a `READY_TO_DISPENSE`, se emite el flujo normal (`AUTHORIZATION_READY_TO_DISPENSE`, notificaciones OLP/Medicarte con las claves de idempotencia existentes). Nunca se ejecuta el reprocesamiento dentro del request HTTP (ADR-014, ADR-004).
7. **Sin efectos retroactivos.** La desactivación de un producto solo aplica a evaluaciones futuras; no modifica `DISPENSATION_REPORTED`, `DISPENSED` ni `APPROVED`. La revalidación nunca toca ítems avanzados. Los ítems preexistentes a la migración se marcan `LISTED` (backfill, sin efecto retroactivo) porque fueron evaluados antes de que existiera el Anexo.
8. **Acceso.** Permisos atómicos `tariff_annex.read|create|import|update|delete`, validados en backend sobre la organización MTD; OLP, Medicarte y Compensar no administran el Anexo (ADR-007).

## Consecuencias

- Un producto fuera del Anexo impide `READY_TO_DISPENSE`; crearlo o activarlo después habilita la revalidación automática sin recargar el archivo de autorizaciones.
- La base de novedades EPS (on-demand, CSV/XLSX, ADR-018) expone los registros sin `READY_TO_DISPENSE` con todas sus causales activas; una autorización revalidada deja de aparecer por la causal del Anexo.
- El Anexo inicia vacío: MTD debe cargar los productos antes (o después) de importar autorizaciones.

## Detalle completo

El detalle funcional y de aceptación está en `../specs/SPEC-014-anexo-tarifario.md`.
