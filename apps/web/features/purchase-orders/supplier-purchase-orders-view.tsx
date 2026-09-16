'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import { completeSupplierReview, listSupplierPurchaseOrders, reviewSupplierLine } from '@/lib/purchase-orders-api';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';

export function SupplierPurchaseOrdersView() {
  const { organizationId } = useRole();
  const orders = useApiData(() => listSupplierPurchaseOrders(organizationId), [organizationId]);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState({ code: '', product: '', status: '' });
  const review = (orderId: string, lineId: string, version: number, acceptedQuantity: number, cost: number) => {
    void reviewSupplierLine(organizationId, orderId, lineId, { expectedVersion: version, acceptedQuantity, ...(cost > 0 ? { supplierUnitCost: cost } : {}) })
      .then(() => orders.reload()).catch((e: unknown) => setError(e instanceof Error ? e.message : 'No fue posible revisar'));
  };
  return <><PageHeader title="Revisión de órdenes" description="Vista OLP limitada a producto, punto, fecha y cantidades. No contiene datos clínicos." />
     {error ? <div className="login-error">{error}</div> : null}<Card><CardBody><FilterBar><FilterField label="Código OC"><input className="control" value={filter.code} onChange={(e) => setFilter({ ...filter, code: e.target.value })} placeholder="Código" /></FilterField><FilterField label="Producto"><input className="control" value={filter.product} onChange={(e) => setFilter({ ...filter, product: e.target.value })} placeholder="Código comercial" /></FilterField><FilterField label="Estado"><select className="control" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="">Todos</option><option value="ISSUED">Emitida</option><option value="UNDER_OLP_REVIEW">En revisión</option><option value="ACCEPTED">Aceptada</option><option value="PARTIALLY_ACCEPTED">Parcial</option><option value="REJECTED">Rechazada</option></select></FilterField></FilterBar>{(orders.data?.items ?? []).filter((order) => (!filter.code || (order.purchaseOrderCode ?? order.id).toLowerCase().includes(filter.code.toLowerCase())) && (!filter.status || order.status === filter.status) && (!filter.product || order.lines.some((line) => line.commercialCode.toLowerCase().includes(filter.product.toLowerCase())))).map((order) => <section key={order.id} style={{ marginBottom: 24 }}><h3>{order.purchaseOrderCode ?? order.id} · {order.status}</h3>
       <table className="data-table"><thead><tr><th>Producto</th><th>Presentación</th><th>Punto</th><th>Solicitada</th><th>Aceptada</th><th>Faltante</th><th>Costo OLP</th></tr></thead><tbody>{order.lines.map((line) => <tr key={line.id}><td>{line.commercialCode} {line.productDescription}</td><td>{line.presentation ?? 'No registrada'}</td><td>{line.dispensingPointName}</td><td>{line.requestedQuantity}</td><td><input className="control" type="number" min="0" max={line.requestedQuantity} defaultValue={line.acceptedQuantity ?? ''} onBlur={(e) => review(order.id, line.id, order.version, Number(e.currentTarget.value || 0), Number(line.supplierUnitCost ?? 0))} /></td><td>{line.shortage}</td><td><input className="control" type="number" min="0.01" step="0.01" placeholder={line.supplierUnitCost ?? 'Costo'} onBlur={(e) => { const cost = Number(e.currentTarget.value); if (cost > 0) review(order.id, line.id, order.version, line.acceptedQuantity ?? 0, cost); }} /></td></tr>)}</tbody></table>
      {order.status === 'UNDER_OLP_REVIEW' ? <button className="button primary" onClick={() => void completeSupplierReview(organizationId, order.id, order.version).then(() => orders.reload()).catch((e: unknown) => setError(e instanceof Error ? e.message : 'No fue posible completar'))}>Completar revisión</button> : null}</section>)}</CardBody></Card></>;
}
