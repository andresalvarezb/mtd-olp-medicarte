-- Edición manual controlada de autorizaciones.
--
-- Solo MTD puede modificar:
-- - código de producto
-- - cantidad autorizada
-- - fecha final de vigencia
--
-- La autorización backend continúa siendo independiente
-- de la visibilidad del botón en frontend.

INSERT INTO "permissions" (
  "id",
  "code",
  "description"
)
VALUES (
  gen_random_uuid(),
  'authorizations.manual_edit',
  'Manually edit product, quantity and validity end date of an authorization'
)
ON CONFLICT ("code") DO NOTHING;


INSERT INTO "role_permissions" (
  "role_id",
  "permission_id"
)
SELECT
  r."id",
  p."id"
FROM
  "roles" r
CROSS JOIN
  "permissions" p
WHERE
  r."code" IN (
    'MTD_ADMIN',
    'MTD_OPERATOR'
  )
  AND p."code" =
    'authorizations.manual_edit'
ON CONFLICT DO NOTHING;


-- MUTABLE AUTHORIZATION PRODUCT / DOWNSTREAM SNAPSHOTS
--
-- Antes de permitir edición manual del producto, tres tablas
-- imponían una FK compuesta:
--
--   (authorization_item_id, commercial_code)
--     -> authorization_items(id, codigo_medicamento)
--
-- Esa restricción hacía imposible conservar el código histórico
-- cuando el código vigente de la AUTO cambia.
--
-- Desde esta migración:
--
-- - authorization_item_id mantiene la identidad referencial;
-- - commercial_code queda como snapshot operacional/histórico;
-- - la aplicación valida explícitamente contra el producto vigente
--   antes de confirmar;
-- - la edición manual sincroniza la programación activa cuando procede.

ALTER TABLE "patient_schedules"
  DROP CONSTRAINT IF EXISTS
    "patient_schedules_authorization_code_fk";

ALTER TABLE "patient_schedule_history"
  DROP CONSTRAINT IF EXISTS
    "patient_schedule_history_authorization_code_fk";

ALTER TABLE "patient_applications"
  DROP CONSTRAINT IF EXISTS
    "patient_applications_authorization_code_fk";


ALTER TABLE "patient_schedules"
  DROP CONSTRAINT IF EXISTS
    "patient_schedules_authorization_item_fk";

ALTER TABLE "patient_schedules"
  ADD CONSTRAINT
    "patient_schedules_authorization_item_fk"
  FOREIGN KEY ("authorization_item_id")
  REFERENCES "authorization_items" ("id")
  ON DELETE RESTRICT;


ALTER TABLE "patient_schedule_history"
  DROP CONSTRAINT IF EXISTS
    "patient_schedule_history_authorization_item_fk";

ALTER TABLE "patient_schedule_history"
  ADD CONSTRAINT
    "patient_schedule_history_authorization_item_fk"
  FOREIGN KEY ("authorization_item_id")
  REFERENCES "authorization_items" ("id")
  ON DELETE RESTRICT;


ALTER TABLE "patient_applications"
  DROP CONSTRAINT IF EXISTS
    "patient_applications_authorization_item_fk";

ALTER TABLE "patient_applications"
  ADD CONSTRAINT
    "patient_applications_authorization_item_fk"
  FOREIGN KEY ("authorization_item_id")
  REFERENCES "authorization_items" ("id")
  ON DELETE RESTRICT;
