'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import { PointScopeGuard } from '@/components/point-scope/empty-point-scope';
import { listInventory, listInventoryMovements } from '@/lib/inventory-api';

export function InventoryView() {
  const { organizationId } = useRole();
  const inventory = useApiData(() => listInventory(organizationId), [organizationId]);
  const [selected, setSelected] = useState<string | null>(null);
  const movements = useApiData(
    () =>
      selected ? listInventoryMovements(organizationId, selected) : Promise.resolve({ items: [] }),
    [organizationId, selected],
  );
  const lots = inventory.data?.items ?? [];
  return (
    <PointScopeGuard>
      <>
        <PageHeader
          title="Inventario operacional"
          description="Existencias físicas derivadas de recepciones Medicarte confirmadas. El saldo no es editable."
        />
        <Card>
          <CardBody>
            <DataTable
              aria-label="Inventario operacional"
              columns={[
                { label: 'Código comercial' },
                { label: 'Punto' },
                { label: 'Lote' },
                { label: 'Vencimiento' },
                { label: 'Físico' },
                { label: 'Utilizable' },
                { label: 'Estado' },
              ]}
              rows={lots.map((lot) => [
                <button className="button" onClick={() => setSelected(lot.id)}>
                  {lot.commercialCode}
                </button>,
                lot.dispensingPointName,
                lot.lotNumber,
                lot.expirationDate,
                lot.physicalBalance,
                lot.usableBalance,
                lot.expired ? 'Vencido' : 'Vigente',
              ])}
              emptyIcon="INV"
              emptyTitle="Sin existencias"
              emptyDescription="Las recepciones confirmadas aparecerán aquí."
            />
          </CardBody>
        </Card>
        {selected && (
          <Card>
            <CardBody>
              <h2>Movimientos del lote</h2>
              <button className="button" onClick={() => setSelected(null)}>
                Cerrar
              </button>
              <DataTable
                columns={[
                  { label: 'Fecha' },
                  { label: 'Tipo' },
                  { label: 'Variación' },
                  { label: 'Origen' },
                ]}
                rows={(movements.data?.items ?? []).map((movement) => [
                  movement.occurredAt,
                  movement.movementType,
                  movement.quantityDelta,
                  `${movement.sourceType} · ${movement.sourceId}`,
                ])}
                emptyIcon="LED"
                emptyTitle="Sin movimientos"
                emptyDescription="Este lote no tiene movimientos."
              />
            </CardBody>
          </Card>
        )}
      </>
    </PointScopeGuard>
  );
}
