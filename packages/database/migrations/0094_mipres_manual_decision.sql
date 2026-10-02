-- Control operacional manual MIPRES por autorización.
--
-- Principios:
-- - direction_status conserva exclusivamente la evidencia oficial MIPRES.
-- - la decisión manual MTD vive en una dimensión independiente.
-- - MANUALLY_ENABLED no omite las demás validaciones de la AUTO.
-- - MANUALLY_DISABLED bloquea el criterio MIPRES aunque exista
--   direccionamiento oficial confirmado.
-- - PENDING_MANUAL_ENABLEMENT mantiene el criterio MIPRES bloqueado hasta una habilitación manual explícita de MTD.
-- - PENDING_MANUAL_ENABLEMENT representa la causal operacional
--   "Pendiente por habilitar manualmente".
-- - direction_status = CONFIRMED NO habilita automáticamente la AUTO.
-- - cada transición se conserva en historial append-only.

CREATE TABLE "mipres_manual_decision_concepts" (
  "code" varchar(80) PRIMARY KEY NOT NULL,
  "name" varchar(180) NOT NULL,
  "action" varchar(20) NOT NULL,
  "requires_note" boolean NOT NULL DEFAULT false,
  "active" boolean NOT NULL DEFAULT true,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT "mipres_manual_decision_concepts_action_check"
    CHECK ("action" IN ('ENABLE', 'DISABLE')),

  CONSTRAINT "mipres_manual_decision_concepts_code_not_blank_check"
    CHECK (length(btrim("code")) > 0),

  CONSTRAINT "mipres_manual_decision_concepts_name_not_blank_check"
    CHECK (length(btrim("name")) > 0)
);


INSERT INTO "mipres_manual_decision_concepts"
  ("code", "name", "action", "requires_note", "sort_order")
VALUES
  (
    'MIPRES_SUPPORT_VALIDATED',
    'Soporte MIPRES validado',
    'ENABLE',
    false,
    10
  ),
  (
    'EPS_ADMINISTRATIVE_VALIDATION',
    'Validación administrativa EPS',
    'ENABLE',
    false,
    20
  ),
  (
    'MIPRES_CONTINGENCY',
    'Contingencia MIPRES',
    'ENABLE',
    true,
    30
  ),
  (
    'OTHER_ENABLE',
    'Otro',
    'ENABLE',
    true,
    90
  ),
  (
    'DIRECTION_DOES_NOT_MATCH',
    'Direccionamiento no corresponde',
    'DISABLE',
    false,
    10
  ),
  (
    'MIPRES_ANNULLED',
    'MIPRES anulado',
    'DISABLE',
    false,
    20
  ),
  (
    'PRODUCT_DOES_NOT_MATCH',
    'Producto no corresponde',
    'DISABLE',
    false,
    30
  ),
  (
    'DOCUMENT_INCONSISTENCY',
    'Inconsistencia documental',
    'DISABLE',
    true,
    40
  ),
  (
    'OTHER_DISABLE',
    'Otro',
    'DISABLE',
    true,
    90
  )
ON CONFLICT ("code") DO NOTHING;


ALTER TABLE "authorization_items"
  ADD COLUMN "mipres_manual_decision"
    varchar(30) NOT NULL DEFAULT 'PENDING_MANUAL_ENABLEMENT',

  ADD COLUMN "mipres_manual_concept_code"
    varchar(80),

  ADD COLUMN "mipres_manual_note"
    text,

  ADD COLUMN "mipres_manual_updated_at"
    timestamptz,

  ADD COLUMN "mipres_manual_updated_by"
    uuid;


ALTER TABLE "authorization_items"
  ADD CONSTRAINT
    "authorization_items_mipres_manual_decision_check"
  CHECK (
    "mipres_manual_decision" IN (
      'PENDING_MANUAL_ENABLEMENT',
      'MANUALLY_ENABLED',
      'MANUALLY_DISABLED'
    )
  );


ALTER TABLE "authorization_items"
  ADD CONSTRAINT
    "authorization_items_mipres_manual_decision_concept_check"
  CHECK (
    (
      "mipres_manual_decision" = 'PENDING_MANUAL_ENABLEMENT'
      AND "mipres_manual_concept_code" IS NULL
    )
    OR
    (
      "mipres_manual_decision" IN (
        'MANUALLY_ENABLED',
        'MANUALLY_DISABLED'
      )
      AND "mipres_manual_concept_code" IS NOT NULL
    )
  );


ALTER TABLE "authorization_items"
  ADD CONSTRAINT
    "authorization_items_mipres_manual_concept_fk"
  FOREIGN KEY ("mipres_manual_concept_code")
  REFERENCES "mipres_manual_decision_concepts" ("code")
  ON DELETE RESTRICT;


ALTER TABLE "authorization_items"
  ADD CONSTRAINT
    "authorization_items_mipres_manual_updated_by_fk"
  FOREIGN KEY ("mipres_manual_updated_by")
  REFERENCES "users" ("id")
  ON DELETE RESTRICT;


CREATE INDEX
  "authorization_items_mipres_manual_decision_idx"
ON "authorization_items" (
  "mipres_manual_decision",
  "no_prescripcion"
);


CREATE INDEX
  "authorization_items_mipres_prescription_idx"
ON "authorization_items" (
  "no_prescripcion"
)
WHERE btrim("no_prescripcion") <> '';


CREATE TABLE "authorization_mipres_decision_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "authorization_item_id"
    uuid NOT NULL
    REFERENCES "authorization_items" ("id")
    ON DELETE RESTRICT,

  "previous_decision"
    varchar(30) NOT NULL,

  "decision"
    varchar(30) NOT NULL,

  "concept_code"
    varchar(80)
    REFERENCES "mipres_manual_decision_concepts" ("code")
    ON DELETE RESTRICT,

  "note"
    text,

  "actor_id"
    uuid NOT NULL
    REFERENCES "users" ("id")
    ON DELETE RESTRICT,

  "organization_id"
    uuid NOT NULL
    REFERENCES "organizations" ("id")
    ON DELETE RESTRICT,

  "correlation_id"
    uuid NOT NULL,

  "created_at"
    timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT
    "authorization_mipres_decision_history_previous_check"
  CHECK (
    "previous_decision" IN (
      'PENDING_MANUAL_ENABLEMENT',
      'MANUALLY_ENABLED',
      'MANUALLY_DISABLED'
    )
  ),

  CONSTRAINT
    "authorization_mipres_decision_history_decision_check"
  CHECK (
    "decision" IN (
      'PENDING_MANUAL_ENABLEMENT',
      'MANUALLY_ENABLED',
      'MANUALLY_DISABLED'
    )
  ),

  CONSTRAINT
    "authorization_mipres_decision_history_concept_check"
  CHECK (
    (
      "decision" = 'PENDING_MANUAL_ENABLEMENT'
      AND "concept_code" IS NULL
    )
    OR
    (
      "decision" IN (
        'MANUALLY_ENABLED',
        'MANUALLY_DISABLED'
      )
      AND "concept_code" IS NOT NULL
    )
  )
);


CREATE INDEX
  "authorization_mipres_decision_history_item_idx"
ON "authorization_mipres_decision_history" (
  "authorization_item_id",
  "created_at" DESC,
  "id" DESC
);
