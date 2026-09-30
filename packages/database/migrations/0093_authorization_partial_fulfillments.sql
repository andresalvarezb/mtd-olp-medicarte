/*
 * Una autorización puede requerir múltiples
 * entregas/aplicaciones parciales.
 *
 * La identidad deja de ser:
 *
 *   1 AUTO -> 1 fulfillment
 *
 * y pasa a ser:
 *
 *   1 AUTO -> N eventos fulfillment
 *
 * Cada evento conserva su cantidad, tipo,
 * fecha, usuario y evidencia de inventario.
 */

ALTER TABLE authorization_fulfillments
  DROP CONSTRAINT IF EXISTS
    authorization_fulfillments_authorization_unique;


CREATE INDEX IF NOT EXISTS
  authorization_fulfillments_authorization_idx
ON authorization_fulfillments (
  authorization_item_id,
  confirmed_at,
  id
);
