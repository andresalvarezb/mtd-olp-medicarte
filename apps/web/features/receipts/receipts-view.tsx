'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import {
  confirmReceipt,
  createReceipt,
  listMedicarteDeliveries,
  listPendingReceipts,
  updateReceipt,
} from '@/lib/purchase-orders-api';
import type { ReceiptResponse } from '@authorization/contracts';

export function ReceiptsView() {
  const { organizationId } = useRole();
  const pending = useApiData(() => listPendingReceipts(organizationId), [organizationId]);
  const deliveries = useApiData(() => listMedicarteDeliveries(organizationId), [organizationId]);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<ReceiptResponse | null>(null);
  const open = async (deliveryId: string) => {
    try {
      setReceipt(await createReceipt(organizationId, deliveryId));
      pending.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible abrir la recepción');
    }
  };
  const save = async () => {
    if (!receipt) return;
    try {
      setReceipt(
        await updateReceipt(organizationId, receipt.id, {
          expectedVersion: receipt.version,
          lines: receipt.lines.map((line) => ({
            deliveryLineId: line.deliveryLineId,
            receivedQuantity: line.receivedQuantity,
            acceptedQuantity: line.acceptedQuantity,
            rejectedQuantity: line.rejectedQuantity,
            receivedLotNumber: line.receivedLotNumber,
            receivedExpirationDate: line.receivedExpirationDate,
            nonconformityReason: line.nonconformityReason,
            observation: line.observation,
          })),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible guardar');
    }
  };
  const confirm = async () => {
    if (!receipt) return;
    try {
      setReceipt(await confirmReceipt(organizationId, receipt.id, receipt.version));
      pending.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible confirmar');
    }
  };
  return (
    <>
      <PageHeader
        title="Recepciones"
        description="Control físico de entregas OLP. Las cantidades aceptadas quedan disponibles para el siguiente proceso, sin crear inventario."
      />
      {error && <div className="login-error">{error}</div>}
      <Card>
        <CardBody>
          <h2>Deliveries pendientes de recepción</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Referencia</th>
                <th>Punto</th>
                <th>Despacho</th>
                <th>Cantidad</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(deliveries.data?.items ?? [])
                .filter((item) => item.status === 'DISPATCHED')
                .map((delivery) => (
                  <tr key={delivery.id}>
                    <td>{delivery.supplierReference ?? delivery.id}</td>
                    <td>{delivery.lines[0]?.dispensingPointName ?? '-'}</td>
                    <td>{delivery.dispatchedAt ?? '-'}</td>
                    <td>{delivery.lines.reduce((total, line) => total + line.quantity, 0)}</td>
                    <td>
                      <button className="button primary" onClick={() => void open(delivery.id)}>
                        Registrar
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
          <h2>Borradores</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Recepción</th>
                <th>Delivery</th>
                <th>Estado</th>
                <th>Conformidad</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(pending.data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{item.id}</td>
                  <td>{item.deliveryId}</td>
                  <td>{item.status}</td>
                  <td>{item.conformity ?? '-'}</td>
                  <td>
                    <button className="button" onClick={() => setReceipt(item)}>
                      Abrir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
      {receipt && (
        <Card>
          <CardBody>
            <h2>Detalle de recepción</h2>
            {receipt.lines.map((line, index) => (
              <div className="flow" key={line.id}>
                <strong>
                  Línea {index + 1} · esperado {line.expectedLotNumber} ·{' '}
                  {line.expectedExpirationDate}
                </strong>
                <label>
                  Recibido{' '}
                  <input
                    className="control"
                    type="number"
                    min="0"
                    value={line.receivedQuantity}
                    onChange={(e) =>
                      setReceipt({
                        ...receipt,
                        lines: receipt.lines.map((candidate, i) =>
                          i === index
                            ? { ...candidate, receivedQuantity: Number(e.currentTarget.value) }
                            : candidate,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Aceptado{' '}
                  <input
                    className="control"
                    type="number"
                    min="0"
                    value={line.acceptedQuantity}
                    onChange={(e) =>
                      setReceipt({
                        ...receipt,
                        lines: receipt.lines.map((candidate, i) =>
                          i === index
                            ? { ...candidate, acceptedQuantity: Number(e.currentTarget.value) }
                            : candidate,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Rechazado{' '}
                  <input
                    className="control"
                    type="number"
                    min="0"
                    value={line.rejectedQuantity}
                    onChange={(e) =>
                      setReceipt({
                        ...receipt,
                        lines: receipt.lines.map((candidate, i) =>
                          i === index
                            ? { ...candidate, rejectedQuantity: Number(e.currentTarget.value) }
                            : candidate,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Lote observado{' '}
                  <input
                    className="control"
                    value={line.receivedLotNumber ?? ''}
                    onChange={(e) =>
                      setReceipt({
                        ...receipt,
                        lines: receipt.lines.map((candidate, i) =>
                          i === index
                            ? { ...candidate, receivedLotNumber: e.currentTarget.value }
                            : candidate,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Vencimiento observado{' '}
                  <input
                    className="control"
                    type="date"
                    value={line.receivedExpirationDate ?? ''}
                    onChange={(e) =>
                      setReceipt({
                        ...receipt,
                        lines: receipt.lines.map((candidate, i) =>
                          i === index
                            ? { ...candidate, receivedExpirationDate: e.currentTarget.value }
                            : candidate,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
            {receipt.status === 'DRAFT' && (
              <>
                <button className="button" onClick={() => void save()}>
                  Guardar borrador
                </button>
                <button className="button primary" onClick={() => void confirm()}>
                  Confirmar
                </button>
              </>
            )}
          </CardBody>
        </Card>
      )}
    </>
  );
}
