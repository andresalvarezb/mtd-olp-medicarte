-- BR-AUTO-ANN-001
-- Persistencia de anulacion y liberacion de compromisos OC/AUTO.
-- No modifica stock, cantidades de OC ni recepciones.

ALTER TABLE authorization_items
  ADD COLUMN annulled_at timestamptz,
  ADD COLUMN annulled_by uuid REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN annulment_reason text;

ALTER TABLE authorization_items
  ADD CONSTRAINT authorization_items_annulment_consistency_check
  CHECK (
    (annulled_at IS NULL AND annulled_by IS NULL AND annulment_reason IS NULL)
    OR
    (annulled_at IS NOT NULL AND annulled_by IS NOT NULL
      AND annulment_reason IS NOT NULL
      AND length(btrim(annulment_reason)) > 0)
  );

CREATE INDEX authorization_items_annulled_at_idx
  ON authorization_items(annulled_at)
  WHERE annulled_at IS NOT NULL;

ALTER TABLE purchase_order_authorization_sources
  ADD COLUMN released_at timestamptz,
  ADD COLUMN released_by uuid REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE purchase_order_authorization_sources
  ADD CONSTRAINT purchase_order_authorization_sources_release_consistency_check
  CHECK ((released_at IS NULL) = (released_by IS NULL));

CREATE INDEX purchase_order_authorization_sources_active_auth_idx
  ON purchase_order_authorization_sources(
    authorization_item_id,
    purchase_order_line_id
  )
  WHERE released_at IS NULL;


-- BR-AUTO-ANNUL-001: integridad de vínculos históricos y
-- protección frente a vinculaciones concurrentes.

CREATE FUNCTION guard_annulled_purchase_order_sources()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  is_annulled boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.released_at IS NOT NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'PURCHASE_ORDER_RELEASED_SOURCE_IMMUTABLE';
    END IF;

    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.released_at IS NOT NULL
       AND NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'PURCHASE_ORDER_RELEASED_SOURCE_IMMUTABLE';
    END IF;
  END IF;

  IF NEW.released_at IS NULL THEN
    SELECT
      (
        ai.annulled_at IS NOT NULL
        OR ai.source_status_normalized = 'ANULADA'
        OR ai.source_data ? '__mtdAnnulment'
      )
    INTO is_annulled
    FROM authorization_items ai
    WHERE ai.id = NEW.authorization_item_id
    FOR SHARE;

    IF COALESCE(is_annulled, false) THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'AUTHORIZATION_ALREADY_ANNULLED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_annulled_purchase_order_sources
BEFORE INSERT OR UPDATE OR DELETE
ON purchase_order_authorization_sources
FOR EACH ROW
EXECUTE FUNCTION guard_annulled_purchase_order_sources();

-- La anulación es irreversible.
-- No permite rehabilitar una AUTO ni alterar su evidencia
-- o sus metadatos de anulación mediante otra ruta SQL.

CREATE FUNCTION guard_authorization_annulment_immutability()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.annulled_at IS NOT NULL THEN
    IF NEW.annulled_at IS DISTINCT FROM OLD.annulled_at
       OR NEW.annulled_by IS DISTINCT FROM OLD.annulled_by
       OR NEW.annulment_reason IS DISTINCT FROM OLD.annulment_reason
       OR NEW.source_data -> '__mtdAnnulment'
          IS DISTINCT FROM OLD.source_data -> '__mtdAnnulment'
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'AUTHORIZATION_ANNULMENT_IMMUTABLE';
    END IF;
  END IF;

  IF NEW.annulled_at IS NOT NULL THEN
    IF NEW.source_status_normalized <> 'ANULADA'
       OR NEW.enablement_status <> 'BLOCKED_SOURCE_STATUS'
       OR NEW.source_data ->> 'ESTADO_AUTORIZACION' <> 'ANULADA'
       OR NOT (NEW.source_data ? '__mtdAnnulment')
    THEN
      RAISE EXCEPTION USING
        ERRCODE = '23514',
        MESSAGE = 'AUTHORIZATION_ALREADY_ANNULLED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_guard_authorization_annulment_immutability
BEFORE UPDATE
ON authorization_items
FOR EACH ROW
EXECUTE FUNCTION guard_authorization_annulment_immutability();
