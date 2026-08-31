# ADR-024 — Anexo Tarifario como prerrequisito de `LISTO_PARA_DISPENSAR`

**Estado:** ACCEPTED

## Contexto

El Anexo Tarifario es el catálogo administrativo, gestionado por MTD, de los códigos de producto válidos para continuar el flujo de dispensación. La llave de comparación es la ya definida por el contrato: `authorization_items.codigo_medicamento` (proveniente de `COD_COMERCIAL`, normalizado con la misma regla técnica de la llave de negocio). No se crean llaves alternativas ni se usan CUM, CUPS, descripción o principio activo para decidir pertenencia.

## Decisión

1. **Nueva dimensión de validación por ítem.** `authorization_items` persiste el resultado de la validación del Anexo en `tariff_membership_status` (`NO_EVALUADO | LISTADO | NO_LISTADO`) con timestamp y versión de regla. No se colapsa en un campo genérico `VALIDO = SI/NO` (ADR-009: estados ortogonales).
2. **Regla central actualizada.** `deriveOperationStatus()` (paquete dominio) exige `tariffListed = true` además de habilitación, cobertura y direccionamiento. La regla se reutiliza en las tres rutas de materialización existentes: confirmación de importación, revalidación MIPRES y actualización explícita de evidencia. El invariante de PostgreSQL (`authorization_items_ready_prerequisites_check`) se extiende en consecuencia: ninguna ruta de escritura puede persistir `LISTO_PARA_DISPENSAR` con producto fuera del Anexo.
3. **Causal estable.** `PRODUCT_NOT_IN_TARIFF_ANNEX` ("Producto no incluido en el Anexo Tarifario") es derivable de `tariff_membership_status = NO_LISTADO` para bandejas, filtros, reportes, exportaciones, auditoría e indicadores. Un registro puede acumular varias causales simultáneas.
4. **Persistencia del catálogo.** Tabla `tariff_annex_products` con unicidad total sobre el código normalizado, `active` como desactivación lógica (nunca eliminación física: preserva trazabilidad y reconstrucción histórica), versión incremental, actor y organización. PostgreSQL es la única fuente de verdad (ADR-003).
5. **Revalidación event-driven (SPEC-014 §16).** Crear o reactivar un producto emite, en la misma transacción, el evento outbox `tariff.product.activated` con idempotencia por versión de producto. El dispatcher lo entrega a la cola BullMQ `tariff-annex` y el worker ejecuta la revalidación dirigida: únicamente ítems con `codigo_medicamento = codigo_producto` y `tariff_membership_status = 'NO_LISTADO'`. Por cada ítem se resuelve la causal, se re-ejecuta la función central de dominio y, si hay transición real a `LISTO_PARA_DISPENSAR`, se emite el flujo normal (`AUTHORIZATION_READY_TO_DISPENSE`, notificaciones OLP/Medicarte con las claves de idempotencia existentes). Nunca se ejecuta una actualización masiva directa desde el controlador HTTP (ADR-014, ADR-004).
6. **Sin efectos retroactivos.** La desactivación de un producto solo aplica a evaluaciones futuras. La revalidación nunca modifica ítems en `DISPENSACION_REPORTADA` o `DISPENSADO`. Los ítems preexistentes a la migración se marcan `LISTADO` (backfill, sin efecto retroactivo) porque fueron evaluados antes de que existiera el Anexo.
7. **Acceso.** Permisos atómicos `tariff_annex.read|create|import|update|delete`, aplicados en backend sobre la organización MTD (más allá de ocultar la UI, ADR-007). Otros roles MTD solo acceden por asignación explícita de la matriz.

## Consecuencias

- Un producto fuera del Anexo impide `LISTO_PARA_DISPENSAR`; agregar el producto habilita la revalidación automática sin recargar la base de autorizaciones.
- La base de novedades EPS (on-demand, CSV/XLSX, ADR-018) expone los registros sin `LISTO_PARA_DISPENSAR` con todas sus causales activas.
- El Anexo inicia vacío: MTD debe cargar los productos. El mapeo de la plantilla comercial (`tarifario_alto_costo.xlsx`, columna "Código Interno Medicamento") hacia `COD_COMERCIAL` quedó pendiente de confirmación de negocio; no se automatizó su semilla.

## Detalle completo

El detalle funcional y de aceptación está en `../specs/SPEC-014-anexo-tarifario.md`.
