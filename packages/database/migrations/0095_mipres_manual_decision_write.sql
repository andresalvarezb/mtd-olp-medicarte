/*
 * WAVE 3 - decisión manual MIPRES.
 *
 * Añade:
 * - versión exclusiva del agregado de decisión MTD;
 * - versión por evento histórico;
 * - permiso atómico mipres.decision.manage.
 *
 * La evidencia externa MIPRES permanece separada.
 */


ALTER TABLE
  authorization_items

ADD COLUMN IF NOT EXISTS
  mipres_manual_version integer
  DEFAULT 0
  NOT NULL;


DO $$
BEGIN

  IF NOT EXISTS (
    SELECT
      1

    FROM
      pg_constraint

    WHERE
      conname =
        'authorization_items_mipres_manual_version_check'
  )
  THEN

    ALTER TABLE
      authorization_items

    ADD CONSTRAINT
      authorization_items_mipres_manual_version_check

    CHECK (
      mipres_manual_version >= 0
    );

  END IF;

END
$$;


ALTER TABLE
  authorization_mipres_decision_history

ADD COLUMN IF NOT EXISTS
  decision_version integer;


WITH ranked AS (
  SELECT
    id,

    row_number() OVER (
      PARTITION BY
        authorization_item_id

      ORDER BY
        created_at,
        id
    )::integer
      AS version

  FROM
    authorization_mipres_decision_history
)

UPDATE
  authorization_mipres_decision_history h

SET
  decision_version =
    ranked.version

FROM
  ranked

WHERE
  ranked.id =
    h.id

  AND

  h.decision_version
    IS NULL;


ALTER TABLE
  authorization_mipres_decision_history

ALTER COLUMN
  decision_version
SET NOT NULL;


DO $$
BEGIN

  IF NOT EXISTS (
    SELECT
      1

    FROM
      pg_constraint

    WHERE
      conname =
        'authorization_mipres_decision_history_version_check'
  )
  THEN

    ALTER TABLE
      authorization_mipres_decision_history

    ADD CONSTRAINT
      authorization_mipres_decision_history_version_check

    CHECK (
      decision_version > 0
    );

  END IF;

END
$$;


CREATE UNIQUE INDEX IF NOT EXISTS
  authorization_mipres_decision_history_item_version_unique

ON
  authorization_mipres_decision_history (
    authorization_item_id,
    decision_version
  );


UPDATE
  authorization_items i

SET
  mipres_manual_version =
    history.max_version

FROM (
  SELECT
    authorization_item_id,
    max(
      decision_version
    )::integer
      AS max_version

  FROM
    authorization_mipres_decision_history

  GROUP BY
    authorization_item_id
) history

WHERE
  history.authorization_item_id =
    i.id

  AND

  i.mipres_manual_version
    <
  history.max_version;


INSERT INTO permissions (
  code,
  description
)
VALUES (
  'mipres.decision.manage',
  'Manage the internal MTD MIPRES operational decision'
)

ON CONFLICT (
  code
)

DO UPDATE
SET
  description =
    excluded.description;


INSERT INTO role_permissions (
  role_id,
  permission_id
)

SELECT
  r.id,
  p.id

FROM
  roles r

CROSS JOIN
  permissions p

WHERE
  r.code IN (
    'MTD_ADMIN',
    'MTD_OPERATOR'
  )

  AND

  p.code =
    'mipres.decision.manage'

ON CONFLICT
DO NOTHING;
