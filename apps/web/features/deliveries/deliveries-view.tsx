'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import { PointScopeGuard } from '@/components/point-scope/empty-point-scope';
import {
  cancelSupplierDelivery,
  createSupplierDelivery,
  dispatchSupplierDelivery,
  listMedicarteDeliveries,
  listSupplierDeliveries,
  listSupplierPurchaseOrders,
} from '@/lib/purchase-orders-api';
import type { DeliveryResponse } from '@authorization/contracts';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';

export function SupplierDeliveriesView() {
  const { organizationId, hasPermission } = useRole();
  const canManage = hasPermission('supplier_deliveries.manage');
  const deliveries = useApiData(() => listSupplierDeliveries(organizationId), [organizationId]);
  const orders = useApiData(() => listSupplierPurchaseOrders(organizationId), [organizationId]);
  const [error, setError] = useState<string | null>(null);
  const [lotNumber, setLotNumber] = useState('');
  const [expirationDate, setExpirationDate] = useState('');
  const [filter, setFilter] = useState({ reference: '', commercialCode: '', status: '' });
  const create = async (
    order: DeliveryResponse['purchaseOrderId'],
    line: DeliveryResponse['lines'][number],
  ) => {
    try {
      await createSupplierDelivery(organizationId, {
        purchaseOrderId: order,
        lines: [
          {
            purchaseOrderLineId: line.purchaseOrderLineId,
            quantity: line.remainingQuantity,
            lotNumber,
            expirationDate,
          },
        ],
      });
      deliveries.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible crear la entrega');
    }
  };
  return (
    <>
      <PageHeader
        title="Entregas OLP"
        description="Despachos físicos contra cantidades aceptadas. No contiene datos clínicos."
      />
      {error ? <div className="login-error">{error}</div> : null}
      <Card>
        <CardBody>
          <label>
            Lote{' '}
            <input
              className="control"
              value={lotNumber}
              onChange={(event) => setLotNumber(event.currentTarget.value)}
            />
          </label>
          <label>
            Vencimiento{' '}
            <input
              className="control"
              type="date"
              value={expirationDate}
              onChange={(event) => setExpirationDate(event.currentTarget.value)}
            />
          </label>
            <FilterBar><FilterField label="Referencia"><input className="control" value={filter.reference} onChange={(e) => setFilter({ ...filter, reference: e.target.value })} placeholder="Referencia" /></FilterField><FilterField label="Código"><input className="control" value={filter.commercialCode} onChange={(e) => setFilter({ ...filter, commercialCode: e.target.value })} placeholder="Producto" /></FilterField><FilterField label="Estado"><select className="control" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="">Todos</option><option value="DRAFT">Borrador</option><option value="DISPATCHED">Despachada</option><option value="RECEIVED">Recibida</option><option value="CANCELLED">Cancelada</option></select></FilterField></FilterBar>
          <table className="data-table">
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Producto</th>
                <th>Punto</th>
                <th>Aceptada</th>
                <th>Despachada</th>
                <th>Saldo</th>
                <th>Lote</th>
                <th>Vencimiento</th>
                <th>Estado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(deliveries.data?.items ?? []).filter((delivery) => (!filter.status || delivery.status === filter.status) && (!filter.reference || (delivery.supplierReference ?? delivery.id).toLowerCase().includes(filter.reference.toLowerCase()))).flatMap((delivery) =>
                delivery.lines.filter((line) => !filter.commercialCode || line.commercialCode.toLowerCase().includes(filter.commercialCode.toLowerCase())).map((line) => (
                  <tr key={`${delivery.id}-${line.id}`}>
                    <td>{delivery.supplierReference ?? delivery.id}</td>
                    <td>
                      {line.commercialCode} {line.productDescription}
                    </td>
                    <td>{line.dispensingPointName}</td>
                    <td>{line.acceptedQuantity}</td>
                    <td>{line.dispatchedQuantity}</td>
                    <td>{line.remainingQuantity}</td>
                    <td>{line.lotNumber}</td>
                    <td>{line.expirationDate}</td>
                    <td>{delivery.status}</td>
                    <td>
                      {canManage && delivery.status === 'DRAFT' ? (
                        <>
                          <button
                            className="button"
                            onClick={() =>
                              void dispatchSupplierDelivery(
                                organizationId,
                                delivery.id,
                                delivery.version,
                              )
                                .then(() => deliveries.reload())
                                .catch((e: unknown) =>
                                  setError(
                                    e instanceof Error ? e.message : 'No fue posible despachar',
                                  ),
                                )
                            }
                          >
                            Despachar
                          </button>
                          <button
                            className="button"
                            onClick={() =>
                              void cancelSupplierDelivery(
                                organizationId,
                                delivery.id,
                                delivery.version,
                              )
                                .then(() => deliveries.reload())
                                .catch((e: unknown) =>
                                  setError(
                                    e instanceof Error ? e.message : 'No fue posible cancelar',
                                  ),
                                )
                            }
                          >
                            Cancelar
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
          <p>Crear DRAFT contra una línea aceptada:</p>
           {canManage && (orders.data?.items ?? []).flatMap((order) =>
            order.lines
              .filter((line) => (line.acceptedQuantity ?? 0) > 0)
              .map((line) => (
                <button
                  className="button primary"
                  key={`new-${order.id}-${line.id}`}
                  onClick={() =>
                    void create(order.id, {
                      id: line.id,
                      purchaseOrderLineId: line.id,
                      quantity: line.acceptedQuantity ?? 0,
                      lotNumber: '',
                      expirationDate: '',
                      acceptedQuantity: line.acceptedQuantity ?? 0,
                      dispatchedQuantity: 0,
                      remainingQuantity: line.acceptedQuantity ?? 0,
                      commercialCode: line.commercialCode,
                      productDescription: line.productDescription,
                      presentation: line.presentation,
                      dispensingPointId: line.dispensingPointId,
                      dispensingPointCode: line.dispensingPointCode,
                      dispensingPointName: line.dispensingPointName,
                    })
                  }
                >
                  Nueva entrega para {line.commercialCode}
                </button>
              )),
          )}
        </CardBody>
      </Card>
    </>
  );
}

export function MedicarteDeliveriesView() {
  const { organizationId } = useRole();
  const deliveries = useApiData(() => listMedicarteDeliveries(organizationId), [organizationId]);
  const [filter, setFilter] = useState({ reference: '', commercialCode: '' });
  return (
    <PointScopeGuard>
      <>
        {/* bandeja Medicarte */}
        <PageHeader
          title="Entregas en camino"
          description="Bandeja logística de entregas despachadas, sin precios ni datos de pacientes."
        />
        <Card>
          <CardBody>
            <FilterBar><FilterField label="Referencia"><input className="control" value={filter.reference} onChange={(e) => setFilter({ ...filter, reference: e.target.value })} placeholder="Referencia" /></FilterField><FilterField label="Código"><input className="control" value={filter.commercialCode} onChange={(e) => setFilter({ ...filter, commercialCode: e.target.value })} placeholder="Producto" /></FilterField></FilterBar>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Referencia</th>
                  <th>Punto</th>
                  <th>Producto</th>
                  <th>Cantidad</th>
                  <th>Lote</th>
                  <th>Vencimiento</th>
                  <th>Despacho</th>
                </tr>
              </thead>
              <tbody>
                {(deliveries.data?.items ?? [])
                  .filter((delivery) => delivery.status === 'DISPATCHED')
                  .flatMap((delivery) =>
                    delivery.lines.filter((line) => (!filter.reference || (delivery.supplierReference ?? delivery.id).toLowerCase().includes(filter.reference.toLowerCase())) && (!filter.commercialCode || line.commercialCode.toLowerCase().includes(filter.commercialCode.toLowerCase()))).map((line) => (
                      <tr key={`${delivery.id}-${line.id}`}>
                        <td>{delivery.supplierReference ?? delivery.id}</td>
                        <td>{line.dispensingPointName}</td>
                        <td>
                          {line.commercialCode} {line.productDescription}
                        </td>
                        <td>{line.quantity}</td>
                        <td>{line.lotNumber}</td>
                        <td>{line.expirationDate}</td>
                        <td>{delivery.dispatchedAt ?? '-'}</td>
                      </tr>
                    )),
                  )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </>
    </PointScopeGuard>
  );
}
