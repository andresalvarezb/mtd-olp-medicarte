'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import { listInventory } from '@/lib/inventory-api';
import {
  cancelStockTransfer,
  createStockTransfer,
  dispatchStockTransfer,
  listStockTransfers,
  receiveStockTransfer,
} from '@/lib/stock-transfers-api';

export function StockTransfersView() {
  const { organizationId } = useRole();
  const transfers = useApiData(() => listStockTransfers(organizationId), [organizationId]);
  const inventory = useApiData(
    () => listInventory(organizationId, { usable: 'true' }),
    [organizationId],
  );
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [lot, setLot] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const run = async (action: () => Promise<unknown>) => {
    try {
      setError(null);
      await action();
      transfers.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No fue posible completar la operación');
    }
  };
  return (
    <>
      <PageHeader
        title="Traslados"
        description="Movimiento físico entre puntos. El tránsito no forma parte del saldo utilizable."
      />
      {error && <div className="login-error">{error}</div>}
      <Card>
        <CardBody>
          <h2>Nuevo traslado</h2>
          <div className="flow">
            <label>
              Origen{' '}
              <input
                className="control"
                value={source}
                onChange={(e) => setSource(e.currentTarget.value)}
                placeholder="ID del punto origen"
              />
            </label>
            <label>
              Destino{' '}
              <input
                className="control"
                value={destination}
                onChange={(e) => setDestination(e.currentTarget.value)}
                placeholder="ID del punto destino"
              />
            </label>
            <label>
              Lote origen{' '}
              <select
                className="control"
                value={lot}
                onChange={(e) => setLot(e.currentTarget.value)}
              >
                <option value="">Seleccionar lote</option>
                {(inventory.data?.items ?? [])
                  .filter((item) => item.usableBalance > 0)
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.commercialCode} · {item.lotNumber} · vence {item.expirationDate} ·
                      usable {item.usableBalance}
                    </option>
                  ))}
              </select>
            </label>
            <label>
              Cantidad{' '}
              <input
                className="control"
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.currentTarget.value))}
              />
            </label>
            <button
              className="button primary"
              disabled={!source || !destination || !lot || quantity < 1}
              onClick={() =>
                void run(() =>
                  createStockTransfer(organizationId, {
                    sourceDispensingPointId: source,
                    destinationDispensingPointId: destination,
                    lines: [{ sourceInventoryLotId: lot, quantity }],
                  }),
                )
              }
            >
              Crear
            </button>
          </div>
        </CardBody>
      </Card>
      <Card>
        <CardBody>
          <h2>Traslados registrados</h2>
          <table className="data-table">
            <thead>
              <tr>
                <th>Origen</th>
                <th>Destino</th>
                <th>Estado</th>
                <th>Productos / lotes</th>
                <th>Tránsito</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {(transfers.data?.items ?? []).map((item) => (
                <tr key={item.id}>
                  <td>{item.sourceDispensingPointName}</td>
                  <td>{item.destinationDispensingPointName}</td>
                  <td>{item.status}</td>
                  <td>
                    {item.lines
                      .map(
                        (line) =>
                          `${line.commercialCode} · ${line.lotNumber} · ${line.expirationDate} · ${line.quantity} · usable origen ${line.sourceUsableBalance} · saldo destino ${line.destinationPhysicalBalance}`,
                      )
                      .join(' | ')}
                  </td>
                  <td>{item.inTransit}</td>
                  <td>
                    {item.status === 'CREATED' && (
                      <>
                        <button
                          className="button"
                          onClick={() =>
                            void run(() =>
                              dispatchStockTransfer(organizationId, item.id, item.version),
                            )
                          }
                        >
                          Despachar
                        </button>{' '}
                        <button
                          className="button"
                          onClick={() =>
                            void run(() =>
                              cancelStockTransfer(organizationId, item.id, item.version),
                            )
                          }
                        >
                          Cancelar
                        </button>
                      </>
                    )}
                    {item.status === 'DISPATCHED' && (
                      <button
                        className="button primary"
                        onClick={() =>
                          void run(() =>
                            receiveStockTransfer(organizationId, item.id, item.version),
                          )
                        }
                      >
                        Recibir
                      </button>
                    )}
                    {(item.status === 'RECEIVED' || item.status === 'CANCELLED') && 'Solo lectura'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardBody>
      </Card>
    </>
  );
}
