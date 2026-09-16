'use client';
import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { useApiData } from '@/hooks/use-api-data';
import { useRole } from '@/components/layout/role-context';
import { PointScopeGuard } from '@/components/point-scope/empty-point-scope';
import { listInventory, listInventoryMovements } from '@/lib/inventory-api';
import { FilterBar, FilterField } from '@/components/ui/filter-bar';

export function InventoryView() {
  const { organizationId } = useRole();
  const inventory = useApiData(() => listInventory(organizationId), [organizationId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState({ commercialCode: '', lotNumber: '', status: '' });
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
            <FilterBar><FilterField label="Código comercial"><input className="control" value={filter.commercialCode} onChange={(e) => setFilter({ ...filter, commercialCode: e.target.value })} placeholder="Producto" /></FilterField><FilterField label="Lote"><input className="control" value={filter.lotNumber} onChange={(e) => setFilter({ ...filter, lotNumber: e.target.value })} placeholder="Lote" /></FilterField><FilterField label="Estado"><select className="control" value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}><option value="">Todos</option><option value="CURRENT">Vigente</option><option value="EXPIRED">Vencido</option></select></FilterField></FilterBar>
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
               rows={lots.filter((lot) => (!filter.commercialCode || lot.commercialCode.toLowerCase().includes(filter.commercialCode.toLowerCase())) && (!filter.lotNumber || lot.lotNumber.toLowerCase().includes(filter.lotNumber.toLowerCase())) && (!filter.status || (filter.status === 'EXPIRED' ? lot.expired : !lot.expired))).map((lot) => [
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
