'use client';

import { useMemo, useState } from 'react';

import { useRole } from '@/components/layout/role-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import {
  FilterActions,
  FilterBar,
  FilterField,
} from '@/components/ui/filter-bar';
import { useApiData } from '@/hooks/use-api-data';
import { listTariffProducts, type TariffProductListItem } from '@/lib/tariff-products-api';

function formatCurrency(product: TariffProductListItem): string {
  const raw = product.tarifaUnidadCanonical ?? product.tarifaUnidad;

  if (!raw) {
    return '—';
  }

  const value = Number(String(raw).trim().replace(',', '.'));

  if (!Number.isFinite(value)) {
    return String(raw);
  }

  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return '—';
  }

  return new Intl.DateTimeFormat('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const COLUMNS = [
  { label: 'Código' },
  { label: 'Producto' },
  { label: 'Tarifa unidad' },
  { label: 'INVIMA / presentación' },
  { label: 'CUM' },
  { label: 'Laboratorio' },
  { label: 'Cobertura' },
  { label: 'Punto predeterminado' },
  { label: 'Actualización' },
];


export function TariffProductsTable() {
  const { organizationId } = useRole();

  const [search, setSearch] = useState('');
  const [inclusion, setInclusion] = useState('ALL');
  const [point, setPoint] = useState('ALL');

  const [appliedSearch, setAppliedSearch] = useState('');
  const [appliedInclusion, setAppliedInclusion] = useState('ALL');
  const [appliedPoint, setAppliedPoint] = useState('ALL');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const { data, loading, error } = useApiData(
    () => listTariffProducts(organizationId),
    [organizationId],
  );

  const products = useMemo(() => data?.items ?? [], [data?.items]);

  const pointOptions = useMemo(() => {
    const points = new Map<string, string>();

    for (const product of products) {
      const current = product.defaultApplicationPoint;

      if (!current) {
        continue;
      }

      points.set(current.id, current.name);
    }

    return Array.from(points.entries())
      .map(([id, name]) => ({
        id,
        name,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [products]);

  const filtered = useMemo(() => {
    const term = appliedSearch.trim().toLocaleLowerCase('es');

    return products.filter((product) => {
      if (
        appliedInclusion !== 'ALL' &&
        (product.tipoInclusion ?? '').trim().toUpperCase() !== appliedInclusion
      ) {
        return false;
      }

      if (appliedPoint === 'MISSING' && product.defaultApplicationPoint) {
        return false;
      }

      if (
        appliedPoint !== 'ALL' &&
        appliedPoint !== 'MISSING' &&
        product.defaultApplicationPoint?.id !== appliedPoint
      ) {
        return false;
      }

      if (!term) {
        return true;
      }

      const searchable = [
        product.codigoProducto,
        product.descripcionGenerica,
        product.descripcionComercial,
        product.numeroExpedienteInvima,
        product.consecutivoInvimaPresentacion,
        product.sourceCumCode,
        product.laboratorio,
        product.tipoInclusion,
        product.defaultApplicationPoint?.name,
        product.defaultApplicationPoint?.code,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase('es');

      return searchable.includes(term);
    });
  }, [products, appliedSearch, appliedInclusion, appliedPoint]);


  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));

  const currentPage = Math.min(page, totalPages);

  const startIndex = totalFiltered === 0 ? 0 : (currentPage - 1) * pageSize;

  const endIndex = Math.min(startIndex + pageSize, totalFiltered);

  const paginatedProducts = filtered.slice(startIndex, endIndex);

  const rows = paginatedProducts.map((product) => [
    product.codigoProducto,
    product.descripcionGenerica ?? product.descripcionComercial ?? '—',
    formatCurrency(product),
    [product.numeroExpedienteInvima, product.consecutivoInvimaPresentacion]
      .filter(Boolean)
      .join(' / ') || '—',
    product.sourceCumCode ?? '—',
    product.laboratorio ?? '—',
    product.tipoInclusion ?? '—',
    product.defaultApplicationPoint
      ? product.defaultApplicationPoint.name
      : 'Sin punto configurado',
    formatDate(product.updatedAt),
  ]);

  function applyFilters() {
    setAppliedSearch(search);
    setAppliedInclusion(inclusion);
    setAppliedPoint(point);
    setPage(1);
  }

  function clearFilters() {
    setSearch('');
    setInclusion('ALL');
    setPoint('ALL');

    setAppliedSearch('');
    setAppliedInclusion('ALL');
    setAppliedPoint('ALL');

    setPage(1);
  }

  return (
    <div
      style={{
        marginTop: 18,
        marginBottom: 18,
      }}
    >
      <Card className="operational-list-workspace">
        <FilterBar>
          <FilterField label="Buscar producto">
            <input
              className="control"
              aria-label="Buscar producto"
              value={search}
              onChange={(event) =>
                setSearch(
                  event.target.value,
                )
              }
              onKeyDown={(event) => {
                if (
                  event.key ===
                  'Enter'
                ) {
                  applyFilters();
                }
              }}
              placeholder="Código, producto, INVIMA, CUM o laboratorio"
            />
          </FilterField>

          <FilterField label="Cobertura">
            <select
              className="control"
              aria-label="Cobertura"
              value={inclusion}
              onChange={(event) =>
                setInclusion(
                  event.target.value,
                )
              }
            >
              <option value="ALL">
                PBS / NO PBS
              </option>

              <option value="PBS">
                PBS
              </option>

              <option value="NO_PBS">
                NO PBS
              </option>
            </select>
          </FilterField>

          <FilterField label="Punto predeterminado">
            <select
              className="control"
              aria-label="Punto predeterminado"
              value={point}
              onChange={(event) =>
                setPoint(
                  event.target.value,
                )
              }
            >
              <option value="ALL">
                Todos los puntos
              </option>

              {pointOptions.map(
                (option) => (
                  <option
                    key={option.id}
                    value={option.id}
                  >
                    {option.name}
                  </option>
                ),
              )}

              <option value="MISSING">
                Sin punto configurado
              </option>
            </select>
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
            className="login-error list-inline-error"
            role="alert"
          >
            {error}
          </div>
        ) : null}

        <div className="operational-list-table-scope tariff-products-table">
          <DataTable
            columns={COLUMNS}
            rows={
              loading
                ? undefined
                : rows
            }
            aria-label="Productos del Anexo Tarifario vigente"
            emptyIcon="AT"
            emptyTitle={
              loading
                ? 'Cargando Anexo Tarifario…'
                : 'Sin productos'
            }
            emptyDescription={
              loading
                ? 'Consultando la configuración vigente.'
                : 'No existen productos que coincidan con los filtros aplicados.'
            }
          />
        </div>

        {!loading ? (
          <div className="list-pagination">
            <div className="list-pagination-summary">
              <span>
                {totalFiltered === 0
                  ? 'Mostrando 0–0 de 0'
                  : `Mostrando ${startIndex + 1}–${endIndex} de ${totalFiltered}`}
              </span>

              <label>
                <span>
                  Filas
                </span>

                <select
                  className="control list-page-size"
                  aria-label="Filas por página"
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

            <div className="list-pagination-controls">
              <button
                type="button"
                className="btn"
                disabled={
                  totalFiltered === 0 ||
                  currentPage <= 1
                }
                onClick={() =>
                  setPage(
                    Math.max(
                      1,
                      currentPage - 1,
                    ),
                  )
                }
              >
                Anterior
              </button>

              <strong>
                Página {currentPage} de {totalPages}
              </strong>

              <button
                type="button"
                className="btn"
                disabled={
                  totalFiltered === 0 ||
                  currentPage >= totalPages
                }
                onClick={() =>
                  setPage(
                    Math.min(
                      totalPages,
                      currentPage + 1,
                    ),
                  )
                }
              >
                Siguiente
              </button>
            </div>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
