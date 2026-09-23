'use client';

import Link from 'next/link';

import { useEffect, useMemo, useState } from 'react';

import { PageHeader } from '@/components/ui/page-header';

import { Card } from '@/components/ui/card';

import { DataTable } from '@/components/ui/data-table';

import { FilterActions, FilterBar, FilterField } from '@/components/ui/filter-bar';

import { useRole } from '@/components/layout/role-context';

import {
  downloadAvailabilityTemplate,
  listInventoryAvailability,
  type InventoryAvailabilityItem,
} from '@/lib/inventory-availability-api';

const COLUMNS = [
  {
    label: 'Código producto',
  },
  {
    label: 'Nombre producto',
  },
  {
    label: 'OC',
  },
  {
    label: 'Punto',
  },
  {
    label: 'Disponible',
  },
  {
    label: 'Asignado',
  },
  {
    label: 'Total',
  },
];

function quantity(value: number) {
  return value.toLocaleString('es-CO');
}

export function DisponibilidadView() {
  const { organizationId, hasPermission } = useRole();

  const [product, setProduct] = useState('');

  const [purchaseOrder, setPurchaseOrder] = useState('');

  const [dispensingPoint, setDispensingPoint] = useState('');

  const [applied, setApplied] = useState({
    product: '',

    purchaseOrder: '',

    dispensingPoint: '',
  });

  const [items, setItems] = useState<InventoryAvailabilityItem[]>([]);

  const [loading, setLoading] = useState(true);

  const [downloading, setDownloading] = useState(false);

  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);

  const [pageSize, setPageSize] = useState(10);

  const canAllocate = hasPermission('inventory.allocate');

  useEffect(() => {
    if (!organizationId) {
      setItems([]);

      setLoading(false);

      return;
    }

    const load = async () => {
      setLoading(true);

      setError(null);

      try {
        const response = await listInventoryAvailability(organizationId, {
          search: applied.product || undefined,

          purchaseOrder: applied.purchaseOrder || undefined,

          dispensingPoint: applied.dispensingPoint || undefined,

          limit: 500,
        });

        setItems(response.items);

        setPage(1);
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'No fue posible consultar la disponibilidad.',
        );
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [organizationId, applied.product, applied.purchaseOrder, applied.dispensingPoint]);

  const totalPages = Math.max(Math.ceil(items.length / pageSize), 1);

  const safePage = Math.min(page, totalPages);

  const firstVisible =
    items.length > 0
      ? (safePage - 1) * pageSize + 1
      : 0;

  const lastVisible =
    Math.min(
      safePage * pageSize,
      items.length,
    );

  const visibleItems = useMemo(() => {
    const start = (safePage - 1) * pageSize;

    return items.slice(start, start + pageSize);
  }, [items, safePage]);

  const hasFilters = Boolean(applied.product || applied.purchaseOrder || applied.dispensingPoint);

  function applyFilters() {
    setApplied({
      product: product.trim(),

      purchaseOrder: purchaseOrder.trim(),

      dispensingPoint: dispensingPoint.trim(),
    });
  }

  function clearFilters() {
    setProduct('');

    setPurchaseOrder('');

    setDispensingPoint('');

    setApplied({
      product: '',

      purchaseOrder: '',

      dispensingPoint: '',
    });
  }

  async function downloadTemplate() {
    if (!organizationId || downloading) {
      return;
    }

    setDownloading(true);

    setError(null);

    try {
      const blob = await downloadAvailabilityTemplate(organizationId);

      const url = URL.createObjectURL(blob);

      const anchor = document.createElement('a');

      anchor.href = url;

      anchor.download = 'plantilla-disponibilidad.xlsx';

      anchor.click();

      URL.revokeObjectURL(url);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'No fue posible descargar la plantilla.');
    } finally {
      setDownloading(false);
    }
  }

  const rows = visibleItems.map((item) => [
    <span
      key={`${item.purchaseOrderId}-${item.commercialCode}-${item.dispensingPointId ?? 'no-point'}-code`}
      style={{
        fontWeight: 600,
      }}
    >
      {item.commercialCode}
    </span>,

    item.productDescription ?? 'Sin nombre',

    item.purchaseOrderCode,

    item.dispensingPointCode ?? 'Sin punto',

    quantity(item.availableQuantity),

    quantity(item.assignedQuantity),

    quantity(item.totalQuantity),
  ]);

  return (
    <>
      <PageHeader
        title="Disponibilidad"
        description="Inventario recibido por orden de compra disponible para asignación."
        actions={
          <>
            <button
              type="button"
              className="btn"
              disabled={downloading}
              onClick={() => void downloadTemplate()}
            >
              {downloading ? 'Descargando…' : 'Descargar plantilla'}
            </button>

            {canAllocate ? (
              <Link
                href="/inventario/disponibilidad/cargar"
                className="btn primary"
              >
                Cargar disponibilidad
              </Link>
            ) : null}
          </>
        }
      />

      <Card className="operational-list-workspace">
        <FilterBar>
          <FilterField label="Código o nombre producto">
            <input
              className="control"
              placeholder="Buscar por código o nombre"
              value={product}
              onChange={(event) => setProduct(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  applyFilters();
                }
              }}
            />
          </FilterField>

          <FilterField label="OC">
            <input
              className="control"
              placeholder="Número de OC"
              value={purchaseOrder}
              onChange={(event) => setPurchaseOrder(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  applyFilters();
                }
              }}
            />
          </FilterField>

          <FilterField label="Punto">
            <input
              className="control"
              placeholder="Código del punto"
              value={dispensingPoint}
              onChange={(event) => setDispensingPoint(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  applyFilters();
                }
              }}
            />
          </FilterField>

          <FilterActions>
            <button
              type="button"
              className="btn primary"
              onClick={applyFilters}
            >
              Filtrar
            </button>

            <button
              type="button"
              className="btn"
              onClick={clearFilters}
            >
              Limpiar
            </button>
          </FilterActions>
        </FilterBar>

        {error ? (
          <div
            className="login-error"
            role="alert"
            style={{
              margin: '0 0 14px',
            }}
          >
            {error}
          </div>
        ) : null}

        <div className="operational-list-table-scope inventory-availability-table">
          <DataTable
          columns={COLUMNS}
          rows={loading ? undefined : rows}
          aria-label="Disponibilidad por producto, orden de compra y punto"
          emptyIcon="INV"
          emptyTitle={loading ? 'Cargando…' : 'Sin inventario para mostrar'}
          emptyDescription={
            loading
              ? 'Consultando la disponibilidad…'
              : hasFilters
                ? 'No existen productos que coincidan con los filtros aplicados.'
                : 'No existen productos asociados a órdenes de compra para mostrar.'
          }
        />
        </div>

        <div className="inventory-availability-pagination list-pagination">
          <div className="inventory-availability-pagination-summary">
            <span>
              {`Mostrando ${firstVisible}–${lastVisible} de ${items.length}`}
            </span>

            <label className="inventory-availability-page-size-field">
              <span>
                Filas
              </span>

              <select
                className="control inventory-availability-page-size"
                value={pageSize}
                onChange={(event) => {
                  setPageSize(
                    Number(
                      event.target.value,
                    ),
                  );

                  setPage(1);
                }}
              >
                <option value={10}>
                  10
                </option>

                <option value={25}>
                  25
                </option>

                <option value={50}>
                  50
                </option>

                <option value={100}>
                  100
                </option>
              </select>
            </label>
          </div>

          <div className="inventory-availability-pagination-controls">
            <button
              type="button"
              className="btn"
              disabled={
                safePage <= 1 ||
                loading
              }
              onClick={() =>
                setPage(
                  (current) =>
                    Math.max(
                      current - 1,
                      1,
                    ),
                )
              }
            >
              Anterior
            </button>

            <strong>
              Página {safePage} de {totalPages}
            </strong>

            <button
              type="button"
              className="btn"
              disabled={
                safePage >= totalPages ||
                loading
              }
              onClick={() =>
                setPage(
                  (current) =>
                    Math.min(
                      current + 1,
                      totalPages,
                    ),
                )
              }
            >
              Siguiente
            </button>
          </div>
        </div>
      </Card>
    </>
  );
}
