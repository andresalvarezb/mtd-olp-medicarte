-- AC-02: recaudo de cuota moderadora por autorización.
-- No modifica authorization_items.source_data.
-- No crea fulfillment ni modifica OC/inventario.
-- Cada versión es un evento histórico inmutable.

CREATE TABLE authorization_moderator_fee_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  authorization_item_id uuid NOT NULL
    REFERENCES authorization_items(id) ON DELETE RESTRICT,

  version integer NOT NULL,

  status varchar(20) NOT NULL,

  amount_cop numeric(14,2),

  collected_at timestamptz,

  observation text,

  reference text,

  registered_by uuid NOT NULL
    REFERENCES users(id) ON DELETE RESTRICT,

  organization_id uuid NOT NULL
    REFERENCES organizations(id) ON DELETE RESTRICT,

  correlation_id uuid NOT NULL,

  idempotency_key uuid NOT NULL,

  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT authorization_moderator_fee_version_positive
    CHECK (version > 0),

  CONSTRAINT authorization_moderator_fee_status_valid
    CHECK (status IN ('COLLECTED', 'NOT_COLLECTED')),

  CONSTRAINT authorization_moderator_fee_amount_consistency
    CHECK (
      (
        status = 'COLLECTED'
        AND amount_cop IS NOT NULL
        AND amount_cop > 0
        AND collected_at IS NOT NULL
      )
      OR
      (
        status = 'NOT_COLLECTED'
        AND amount_cop IS NULL
        AND collected_at IS NULL
      )
    ),

  CONSTRAINT authorization_moderator_fee_observation_length
    CHECK (
      observation IS NULL
      OR length(observation) <= 1000
    ),

  CONSTRAINT authorization_moderator_fee_reference_length
    CHECK (
      reference IS NULL
      OR length(reference) <= 255
    ),

  CONSTRAINT authorization_moderator_fee_version_unique
    UNIQUE (authorization_item_id, version),

  CONSTRAINT authorization_moderator_fee_idempotency_unique
    UNIQUE (authorization_item_id, idempotency_key)
);

CREATE INDEX authorization_moderator_fee_history_idx
  ON authorization_moderator_fee_events (
    authorization_item_id,
    version DESC
  );

CREATE INDEX authorization_moderator_fee_created_idx
  ON authorization_moderator_fee_events (
    created_at,
    authorization_item_id
  );

-- Evita modificaciones o eliminaciones de eventos existentes.
CREATE FUNCTION guard_moderator_fee_event_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING
    ERRCODE = '23514',
    MESSAGE = 'MODERATOR_FEE_EVENT_IMMUTABLE';
END;
$$;

CREATE TRIGGER trg_moderator_fee_event_immutability
BEFORE UPDATE OR DELETE
ON authorization_moderator_fee_events
FOR EACH ROW
EXECUTE FUNCTION guard_moderator_fee_event_immutability();
