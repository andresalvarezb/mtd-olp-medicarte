-- ESP-003 / pre-ESP-004: identidad canónica de programación (fingerprint).
--
-- La duplicación semántica de una programación es esta terna:
--   authorization_item_id + dispensing_point_id + scheduled_date
-- mientras la programación esté activa (SCHEDULED / RESCHEDULED). Cancelar la
-- programación libera la identidad: volver a programar la misma combinación
-- después de una cancelación es válido.
--
-- El índice único parcial impone la invariante EN LA BASE DE DATOS, en una
-- sola transacción, independientemente de que la escritura provenga de la
-- operación individual, del lote XLSX A o del lote XLSX B. Así:
-- * no se puede confirmar dos veces la misma programación ni siquiera con
--   lotes independientes concurrentes;
-- * ESP-004 no tendrá que deduplicar silenciosamente: cada schedule activo
--   es unívoco por identidad;
-- * el unique es la red definitiva; la API mapea la violación (23505) a un
--   conflicto estructurado `PATIENT_SCHEDULE_DUPLICATE`.

CREATE UNIQUE INDEX IF NOT EXISTS "patient_schedules_active_identity_idx"
  ON "patient_schedules" ("authorization_item_id", "dispensing_point_id", "scheduled_date")
  WHERE "status" IN ('SCHEDULED', 'RESCHEDULED');
