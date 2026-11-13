-- Additive financial lifecycle. Existing rows keep their original meaning and values.
ALTER TABLE authorization_moderator_fee_events
  ADD COLUMN movement_type varchar(20),
  ADD COLUMN related_event_id uuid,
  ADD COLUMN effective_at timestamptz,
  ADD COLUMN reason text,
  ADD COLUMN manual_amount boolean NOT NULL DEFAULT false,
  ADD COLUMN source_amount_cop numeric(14,2),
  ADD COLUMN difference_cop numeric(14,2);

ALTER TABLE authorization_moderator_fee_events
  ADD CONSTRAINT authorization_moderator_fee_related_fk
    FOREIGN KEY (related_event_id) REFERENCES authorization_moderator_fee_events(id) ON DELETE RESTRICT,
  DROP CONSTRAINT authorization_moderator_fee_status_valid,
  ADD CONSTRAINT authorization_moderator_fee_status_valid
    CHECK (status IN ('COLLECTED', 'NOT_COLLECTED', 'REFUNDED', 'INVALIDATED')),
  DROP CONSTRAINT authorization_moderator_fee_amount_consistency,
  ADD CONSTRAINT authorization_moderator_fee_amount_consistency CHECK (
    (status = 'COLLECTED' AND amount_cop > 0 AND collected_at IS NOT NULL)
    OR (status = 'NOT_COLLECTED' AND amount_cop IS NULL AND collected_at IS NULL)
    OR (status = 'REFUNDED' AND amount_cop > 0 AND related_event_id IS NOT NULL
        AND effective_at IS NOT NULL AND reason IS NOT NULL AND length(btrim(reason)) > 0)
    OR (status = 'INVALIDATED' AND amount_cop IS NULL AND related_event_id IS NOT NULL
        AND reason IS NOT NULL AND length(btrim(reason)) > 0)
  ),
  ADD CONSTRAINT authorization_moderator_fee_movement_valid CHECK (
    movement_type IS NULL OR (movement_type = status AND effective_at IS NOT NULL)
  ),
  ADD CONSTRAINT authorization_moderator_fee_manual_amount_valid CHECK (
    NOT manual_amount OR (status = 'COLLECTED' AND observation IS NOT NULL
      AND length(btrim(observation)) > 0)
  );

CREATE INDEX authorization_moderator_fee_related_idx
  ON authorization_moderator_fee_events (related_event_id)
  WHERE related_event_id IS NOT NULL;

-- A failed sheet append is kept for explicit retry or accounting reconciliation.
CREATE TABLE moderator_fee_sheet_sync (
  event_id uuid PRIMARY KEY REFERENCES authorization_moderator_fee_events(id) ON DELETE RESTRICT,
  status varchar(30) NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT moderator_fee_sheet_sync_status_valid
    CHECK (status IN ('PENDING', 'SYNCED', 'FAILED', 'RECONCILIATION_REQUIRED'))
);

CREATE INDEX moderator_fee_sheet_sync_pending_idx
  ON moderator_fee_sheet_sync (status, updated_at);
