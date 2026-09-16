'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import { issuePurchaseOrder, listPurchaseOrders } from '@/lib/purchase-orders-api';
import { FilterBar, FilterField, FilterActions } from '@/components/ui/filter-bar';
import type { PurchaseOrderListQuery } from '@authorization/contracts';

export function PurchaseOrdersView() {
  const { organizationId, hasPermission } = useRole();
  const [filters, setFilters] = useState<{ purchaseOrderCode: string; commercialCode: string; status: PurchaseOrderListQuery['status'] }>({ purchaseOrderCode: '', commercialCode: '', status: undefined });
  const [appliedFilters, setAppliedFilters] = useState(filters);
  const orders = useApiData(() => listPurchaseOrders(organizationId, appliedFilters), [organizationId, appliedFilters]);
  const [error, setError] = useState<string | null>(null);
  const canManage = hasPermission('purchase_orders.manage');
  return <><PageHeader title="Órdenes de compra" description="Consolidación logística basada en snapshots de demanda proyectada." actions={<span className="pill blue">{orders.data?.items.length ?? 0} OCs</span>} />
    {error ? <div className="login-error" role="alert">{error}</div> : null}
    <FilterBar>
      <FilterField label="Código OC"><input className="control" value={filters.purchaseOrderCode} onChange={(e) => setFilters({ ...filters, purchaseOrderCode: e.target.value })} placeholder="Buscar código" /></FilterField>
      <FilterField label="Código producto"><input className="control" value={filters.commercialCode} onChange={(e) => setFilters({ ...filters, commercialCode: e.target.value })} placeholder="Código comercial" /></FilterField>
      <FilterField label="Estado"><select className="control" value={filters.status ?? ''} onChange={(e) => setFilters({ ...filters, status: (e.target.value || undefined) as PurchaseOrderListQuery['status'] })}><option value="">Todos</option><option value="DRAFT">Borrador</option><option value="ISSUED">Emitida</option><option value="UNDER_OLP_REVIEW">En revisión</option><option value="ACCEPTED">Aceptada</option><option value="PARTIALLY_ACCEPTED">Parcial</option><option value="REJECTED">Rechazada</option><option value="CANCELLED">Cancelada</option></select></FilterField>
      <FilterActions><button className="button primary" onClick={() => setAppliedFilters(filters)}>Filtrar</button><button className="button" onClick={() => { const cleared = { purchaseOrderCode: '', commercialCode: '', status: undefined as PurchaseOrderListQuery['status'] }; setFilters(cleared); setAppliedFilters(cleared); }}>Limpiar</button></FilterActions>
    </FilterBar>
    <Card><CardBody><table className="data-table"><thead><tr><th>Código</th><th>Período</th><th>Tipo</th><th>Estado</th><th>Líneas</th><th /></tr></thead><tbody>{(orders.data?.items ?? []).map((order) => <tr key={order.id}><td>{order.purchaseOrderCode ?? 'Borrador sin código'}</td><td>{order.planningPeriodId}</td><td>{order.orderType}</td><td>{order.status}</td><td>{order.lines.length}</td><td>{canManage && order.status === 'DRAFT' && order.purchaseOrderCode ? <button className="button primary" onClick={() => void issuePurchaseOrder(organizationId, order.id, order.version).then(() => orders.reload()).catch((e: unknown) => setError(e instanceof Error ? e.message : 'No fue posible emitir'))}>Emitir</button> : null}</td></tr>)}</tbody></table></CardBody></Card></>;
}
