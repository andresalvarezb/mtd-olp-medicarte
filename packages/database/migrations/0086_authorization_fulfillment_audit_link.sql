ALTER TABLE audit_reviews
ADD COLUMN IF NOT EXISTS authorization_fulfillment_id uuid
REFERENCES authorization_fulfillments(id)
ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS
  audit_reviews_authorization_fulfillment_unique
ON audit_reviews (
  authorization_fulfillment_id
)
WHERE authorization_fulfillment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS
  audit_reviews_authorization_fulfillment_status_idx
ON audit_reviews (
  authorization_fulfillment_id,
  status
)
WHERE authorization_fulfillment_id IS NOT NULL;
