'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import { issuePurchaseOrder, listPurchaseOrders } from '@/lib/purchase-orders-api';

export function PurchaseOrdersView() {
  const { organizationId, hasPermission } = useRole();
  const orders = useApiData(() => listPurchaseOrders(organizationId), [organizationId]);
  const [error, setError] = useState<string | null>(null);
  const canManage = hasPermission('purchase_orders.manage');
  return <><PageHeader title="Órdenes de compra" description="Consolidación logística basada en snapshots de demanda proyectada." actions={<span className="pill blue">{orders.data?.items.length ?? 0} OCs</span>} />
    {error ? <div className="login-error" role="alert">{error}</div> : null}
    <Card><CardBody><table className="data-table"><thead><tr><th>Código</th><th>Período</th><th>Tipo</th><th>Estado</th><th>Líneas</th><th /></tr></thead><tbody>{(orders.data?.items ?? []).map((order) => <tr key={order.id}><td>{order.purchaseOrderCode ?? 'Borrador sin código'}</td><td>{order.planningPeriodId}</td><td>{order.orderType}</td><td>{order.status}</td><td>{order.lines.length}</td><td>{canManage && order.status === 'DRAFT' && order.purchaseOrderCode ? <button className="button primary" onClick={() => void issuePurchaseOrder(organizationId, order.id, order.version).then(() => orders.reload()).catch((e: unknown) => setError(e instanceof Error ? e.message : 'No fue posible emitir'))}>Emitir</button> : null}</td></tr>)}</tbody></table></CardBody></Card></>;
}
