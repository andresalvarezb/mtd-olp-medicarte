/*
 * Corrige 0084:
 *
 * La liberación por vencimiento NO se solicita por XLS.
 * Ocurre automáticamente a partir del día 6.
 *
 * La plantilla de Disponibilidad vuelve a ser exclusivamente
 * un mecanismo de ASIGNACIÓN manual.
 */

DROP TABLE IF EXISTS
  inventory_allocation_release_events;


ALTER TABLE
  inventory_allocation_import_rows
DROP COLUMN IF EXISTS
  operation_type;


ALTER TABLE
  inventory_allocation_batches
DROP COLUMN IF EXISTS
  released_quantity;
