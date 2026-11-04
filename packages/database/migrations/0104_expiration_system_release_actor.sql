ALTER TABLE purchase_order_authorization_sources
  ADD COLUMN released_by_type varchar(10);

UPDATE purchase_order_authorization_sources
SET released_by_type = 'USER'
WHERE released_at IS NOT NULL
  AND released_by IS NOT NULL;

ALTER TABLE purchase_order_authorization_sources
  DROP CONSTRAINT purchase_order_authorization_sources_release_consistency_check;

ALTER TABLE purchase_order_authorization_sources
  ADD CONSTRAINT purchase_order_authorization_sources_release_consistency_check
  CHECK (
    (released_at IS NULL
      AND released_by IS NULL
      AND released_by_type IS NULL)
    OR
    (released_at IS NOT NULL
      AND released_by_type = 'USER'
      AND released_by IS NOT NULL)
    OR
    (released_at IS NOT NULL
      AND released_by_type = 'SYSTEM'
      AND released_by IS NULL)
  );

COMMENT ON COLUMN purchase_order_authorization_sources.released_by_type IS
  'USER identifies an explicit release by released_by; SYSTEM records automated release without impersonating a user.';
