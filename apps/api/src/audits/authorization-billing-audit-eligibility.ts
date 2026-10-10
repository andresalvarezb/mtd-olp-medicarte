import { sql, type SQL } from 'drizzle-orm';
import { resolveAuthorizationFulfillmentProgressStatus } from '../clinical/authorization-query-status';

export type BillingAuditFulfillmentRow = {
  id: string;
  authorized_quantity: string | null;
  fulfilled_quantity: number | string;
};

/** Una reserva física no implica atención; solo PARTIAL/COMPLETE es auditable. */
export function isBillingAuditFulfillmentEligible(
  row: Pick<BillingAuditFulfillmentRow, 'authorized_quantity' | 'fulfilled_quantity'>,
): boolean {
  const authorizedQuantity = Number(row.authorized_quantity ?? 0);
  const fulfilledQuantity = Number(row.fulfilled_quantity ?? 0);
  if (!Number.isFinite(authorizedQuantity) || authorizedQuantity <= 0 ||
      !Number.isFinite(fulfilledQuantity) || fulfilledQuantity <= 0) return false;
  const progress = resolveAuthorizationFulfillmentProgressStatus({
    authorizedQuantity, fulfilledQuantity,
  });
  return progress === 'PARTIAL' || progress === 'COMPLETE';
}

/** MAX, no SUM, evita doble contabilizar fulfillment/aplicación/consumo. */
export function billingAuditFulfillmentSnapshotSql(authorizationItemId: string): SQL {
  return sql`
    select i.id, i.source_data->>'CANTIDAD' as authorized_quantity,
      greatest(
        coalesce((select sum(af.quantity)::int from authorization_fulfillments af
          where af.authorization_item_id = i.id), 0),
        coalesce((select sum(pal.quantity)::int from patient_applications pa
          join patient_application_lines pal on pal.patient_application_id = pa.id
          where pa.authorization_item_id = i.id and pa.status = 'CONFIRMED'), 0),
        coalesce((select sum(iaa.consumed_quantity)::int from inventory_authorization_allocations iaa
          where iaa.authorization_item_id = i.id), 0)
      )::int as fulfilled_quantity
    from authorization_items i where i.id = ${authorizationItemId} for update of i
  `;
}
