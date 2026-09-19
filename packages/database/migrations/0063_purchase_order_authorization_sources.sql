-- Macro 3B hardening:
-- immutable authorization provenance for purchase-order lines.
--
-- demand_sources represents live reconciled demand and may be replaced or
-- deleted when eligibility changes. A committed purchase-order line therefore
-- needs its own immutable snapshot of the authorizations that composed the
-- demand revision used to create it.

CREATE TABLE purchase_order_authorization_sources (
  purchase_order_line_id uuid NOT NULL,
  authorization_item_id uuid NOT NULL,
  projected_demand_line_id uuid NOT NULL,
  projected_demand_revision integer NOT NULL,
  source_quantity_snapshot integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT purchase_order_authorization_sources_pk
    PRIMARY KEY (
      purchase_order_line_id,
      authorization_item_id
    ),

  CONSTRAINT purchase_order_authorization_sources_line_fk
    FOREIGN KEY (purchase_order_line_id)
    REFERENCES purchase_order_lines(id)
    ON DELETE CASCADE,

  CONSTRAINT purchase_order_authorization_sources_authorization_fk
    FOREIGN KEY (authorization_item_id)
    REFERENCES authorization_items(id)
    ON DELETE RESTRICT,

  CONSTRAINT purchase_order_authorization_sources_revision_check
    CHECK (projected_demand_revision > 0),

  CONSTRAINT purchase_order_authorization_sources_quantity_check
    CHECK (source_quantity_snapshot > 0)
);

CREATE INDEX purchase_order_authorization_sources_authorization_idx
  ON purchase_order_authorization_sources (
    authorization_item_id,
    purchase_order_line_id
  );

CREATE INDEX purchase_order_authorization_sources_demand_idx
  ON purchase_order_authorization_sources (
    projected_demand_line_id,
    projected_demand_revision
  );

-- Best-effort migration of still-resolvable historical lineage.
-- demand_sources is not revisioned, so historical provenance is backfilled
-- only when the current projected-demand revision still matches the
-- revision consumed by the purchase-order allocation.
-- Older lineage already deleted before this migration cannot be reconstructed.
INSERT INTO purchase_order_authorization_sources (
  purchase_order_line_id,
  authorization_item_id,
  projected_demand_line_id,
  projected_demand_revision,
  source_quantity_snapshot
)
SELECT DISTINCT
  pol.id,
  ds.authorization_item_id,
  allocation.projected_demand_line_id,
  allocation.projected_demand_revision,
  ds.quantity
FROM purchase_order_demand_allocations allocation
JOIN projected_demand_lines pdl
  ON pdl.id = allocation.projected_demand_line_id
 AND pdl.revision = allocation.projected_demand_revision
JOIN purchase_order_lines pol
  ON pol.id = allocation.purchase_order_line_id
 AND pol.projected_demand_line_id =
     allocation.projected_demand_line_id
 AND pol.projected_demand_revision =
     allocation.projected_demand_revision
JOIN demand_sources ds
  ON ds.projected_demand_line_id =
     allocation.projected_demand_line_id
WHERE ds.authorization_item_id IS NOT NULL
ON CONFLICT (
  purchase_order_line_id,
  authorization_item_id
) DO NOTHING;
