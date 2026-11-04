-- A released source remains an immutable historical fact. A renewed AUTO may
-- acquire a new active commitment on the same OC line.
ALTER TABLE purchase_order_authorization_sources
  ADD COLUMN id uuid DEFAULT gen_random_uuid();

UPDATE purchase_order_authorization_sources
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE purchase_order_authorization_sources
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE purchase_order_authorization_sources
  DROP CONSTRAINT purchase_order_authorization_sources_pk;

ALTER TABLE purchase_order_authorization_sources
  ADD CONSTRAINT purchase_order_authorization_sources_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX purchase_order_authorization_sources_active_pair_unique
  ON purchase_order_authorization_sources
    (purchase_order_line_id, authorization_item_id)
  WHERE released_at IS NULL;

COMMENT ON COLUMN purchase_order_authorization_sources.id IS
  'Stable identity of each successive OC-to-AUTO commitment, including released history.';
