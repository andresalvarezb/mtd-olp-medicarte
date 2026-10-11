'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { useRole } from '@/components/layout/role-context';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { FilterActions, FilterBar, FilterField } from '@/components/ui/filter-bar';
import { useApiData } from '@/hooks/use-api-data';
import { useLoadingFeedback } from '@/hooks/use-loading-feedback';
import { listTariffProducts, type TariffProductListItem } from '@/lib/tariff-products-api';
import {
  filterTariffProducts,
  formatTariff,
  numericTariff,
  sellingTariff,
  tariffDiscount,
  tariffProductMetrics,
  tariffProductName,
  type TariffProductFilters,
} from './tariff-products-model';

const COLUMNS = [
  { label: 'Código' },
  { label: 'Medicamento' },
  { label: 'Tarifa venta (TV)' },
  { label: 'Tarifa compra' },
  { label: 'Cobertura' },
  { label: 'Detalle' },
];

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

function detailText(value: string | null | undefined): string {
  return value?.trim() || '—';
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="tariff-detail-field">
      <dt>{label}</dt>
      <dd>{typeof value === 'number' ? value : detailText(value)}</dd>
    </div>
  );
}

function ProductDetail({
  product,
  close,
  closeRef,
}: {
  product: TariffProductListItem;
  close: () => void;
  closeRef: RefObject<HTMLButtonElement | null>;
}) {
  const tv = sellingTariff(product);
  const purchase = numericTariff(product.tarifaCompra);

  return (
    <div
      className="tariff-detail-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <aside
        className="tariff-detail-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tariff-detail-title"
      >
        <header className="tariff-detail-header">
          <div>
            <span className="tariff-detail-eyebrow">Ficha completa del producto</span>
            <h2 id="tariff-detail-title">{tariffProductName(product)}</h2>
            <span className="tariff-detail-code">{product.codigoProducto}</span>
          </div>
          <button
            ref={closeRef}
            className="operation-close"
            type="button"
            onClick={close}
            aria-label="Cerrar detalle del producto"
          >
            ×
          </button>
        </header>

        <div className="tariff-detail-body">
          <section className="tariff-detail-section" aria-label="Información comercial">
            <h3>Información comercial</h3>
            <div className="tariff-detail-prices">
              <div>
                <span>Tarifa venta (TV)</span>
                <strong>{formatTariff(tv)}</strong>
              </div>
              <div>
                <span>Tarifa compra (−5 %)</span>
                <strong>{formatTariff(purchase)}</strong>
              </div>
            </div>
            <dl className="tariff-detail-grid">
              <Field label="Descuento aplicado" value={formatTariff(tariffDiscount(product))} />
              <Field label="Cantidad mínima" value={product.minimumQuantity} />
            </dl>
          </section>

          <section className="tariff-detail-section" aria-label="Identificación del medicamento">
            <h3>Identificación del medicamento</h3>
            <dl className="tariff-detail-grid">
              <Field label="Código comercial" value={product.codigoProducto} />
              <Field label="Descripción genérica" value={product.descripcionGenerica} />
              <Field label="Descripción comercial" value={product.descripcionComercial} />
              <Field label="Laboratorio" value={product.laboratorio} />
              <Field label="Expediente INVIMA" value={product.numeroExpedienteInvima} />
              <Field label="Presentación INVIMA" value={product.consecutivoInvimaPresentacion} />
              <Field label="CUM" value={product.sourceCumCode} />
              <Field label="Cobertura" value={product.tipoInclusion} />
            </dl>
          </section>

          <section className="tariff-detail-section" aria-label="Configuración y trazabilidad">
            <h3>Configuración y trazabilidad</h3>
            <dl className="tariff-detail-grid">
              <Field label="Punto predeterminado" value={product.defaultApplicationPoint?.name} />
              <Field label="Código del punto" value={product.defaultApplicationPoint?.code} />
              <Field label="Estado" value={product.active ? 'Activo' : 'Inactivo'} />
              <Field label="Última actualización" value={formatDate(product.updatedAt)} />
            </dl>
          </section>
        </div>
        <footer className="tariff-detail-footer">
          <button className="btn" type="button" onClick={close}>Cerrar detalle</button>
        </footer>
      </aside>
    </div>
  );
}

export function TariffProductsTable() {
  const { organizationId } = useRole();
  const [search, setSearch] = useState('');
  const [inclusion, setInclusion] = useState('ALL');
  const [point, setPoint] = useState('ALL');
  const [applied, setApplied] = useState<TariffProductFilters>({
    search: '', inclusion: 'ALL', point: 'ALL',
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const { data, loading, error } = useApiData(
    () => listTariffProducts(organizationId),
    [organizationId],
    ['TARIFF_ANNEX'],
  );
  const tariffLoading = useLoadingFeedback(loading);
  const products = useMemo(() => data?.items ?? [], [data?.items]);
  const metrics = useMemo(() => tariffProductMetrics(products), [products]);
  const selected = products.find((product) => product.id === selectedId) ?? null;

  const pointOptions = useMemo(() => {
    const points = new Map<string, string>();
    for (const product of products) {
      const current = product.defaultApplicationPoint;
      if (current) points.set(current.id, current.name);
    }
    return Array.from(points.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [products]);

  const filtered = useMemo(
    () => filterTariffProducts(products, applied),
    [products, applied],
  );
  const totalFiltered = filtered.length;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / pageSize));
  const currentPage = Math.min(page, totalPages);
  const startIndex = totalFiltered === 0 ? 0 : (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalFiltered);
  const paginatedProducts = filtered.slice(startIndex, endIndex);

  function closeDetail() {
    setSelectedId(null);
    triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!selected) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setSelectedId(null);
        triggerRef.current?.focus();
      }
      if (event.key !== 'Tab') return;
      const dialog = closeRef.current?.closest('[role="dialog"]');
      if (!dialog) return;
      const focusables = [...dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selected]);

  const rows = paginatedProducts.map((product) => [
    product.codigoProducto,
    <span key="name" className="tariff-product-name">{tariffProductName(product)}</span>,
    <span key="tv" className="tariff-money">{formatTariff(sellingTariff(product))}</span>,
    <strong key="purchase" className="tariff-money">{formatTariff(numericTariff(product.tarifaCompra))}</strong>,
    product.tipoInclusion ?? '—',
    <button
      key="detail"
      type="button"
      className="btn tariff-detail-trigger"
      aria-label={`Ver detalles de ${tariffProductName(product)}`}
      onClick={(event) => {
        triggerRef.current = event.currentTarget;
        setSelectedId(product.id);
      }}
    >
      Ver detalle <span aria-hidden="true">›</span>
    </button>,
  ]);

  function applyFilters() {
    tariffLoading.trigger();
    setApplied({ search, inclusion, point });
    setPage(1);
  }

  function clearFilters() {
    tariffLoading.trigger();
    setSearch('');
    setInclusion('ALL');
    setPoint('ALL');
    setApplied({ search: '', inclusion: 'ALL', point: 'ALL' });
    setPage(1);
  }

  return (
    <div className="tariff-products-workspace">
      <div className="tariff-products-summary" aria-label="Resumen del Anexo Tarifario">
        <div><span>Productos activos</span><strong>{metrics.total.toLocaleString('es-CO')}</strong></div>
        <div><span>Con tarifa</span><strong>{metrics.withTariff.toLocaleString('es-CO')}</strong></div>
        <div><span>Sin tarifa</span><strong>{metrics.withoutTariff.toLocaleString('es-CO')}</strong></div>
      </div>
      <Card className="operational-list-workspace tariff-products-card">
        <FilterBar>
          <FilterField label="Buscar producto">
            <input
              className="control"
              aria-label="Buscar producto"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter') applyFilters(); }}
              placeholder="Código, producto, INVIMA, CUM o laboratorio"
            />
          </FilterField>
          <FilterField label="Cobertura">
            <select
              className="control"
              aria-label="Cobertura"
              value={inclusion}
              onChange={(event) => setInclusion(event.target.value)}
            >
              <option value="ALL">PBS / NO PBS</option>
              <option value="PBS">PBS</option>
              <option value="NO_PBS">NO PBS</option>
            </select>
          </FilterField>
          <FilterField label="Punto predeterminado">
            <select
              className="control"
              aria-label="Punto predeterminado"
              value={point}
              onChange={(event) => setPoint(event.target.value)}
            >
              <option value="ALL">Todos los puntos</option>
              {pointOptions.map((option) => (
                <option key={option.id} value={option.id}>{option.name}</option>
              ))}
              <option value="MISSING">Sin punto configurado</option>
            </select>
          </FilterField>
          <FilterActions>
            <button type="button" className="btn primary" onClick={applyFilters}>Filtrar</button>
            <button type="button" className="btn" onClick={clearFilters}>Limpiar</button>
          </FilterActions>
        </FilterBar>
        {error ? <div className="login-error list-inline-error" role="alert">{error}</div> : null}
        <div className="operational-list-table-scope tariff-products-table">
          <DataTable
            columns={COLUMNS}
            rows={rows}
            loading={tariffLoading.visible}
            loadingLabel="Cargando Anexo Tarifario"
            aria-label="Productos del Anexo Tarifario vigente"
            emptyIcon="AT"
            emptyTitle="Sin productos"
            emptyDescription="No existen productos que coincidan con los filtros aplicados."
          />
        </div>
        <div className="list-pagination">
          <div className="list-pagination-summary">
            <span>
              {tariffLoading.visible
                ? 'Mostrando —'
                : totalFiltered === 0
                  ? 'Mostrando 0–0 de 0'
                  : `Mostrando ${startIndex + 1}–${endIndex} de ${totalFiltered}`}
            </span>
            <label>
              <span>Filas</span>
              <select
                className="control list-page-size"
                aria-label="Filas por página"
                value={pageSize}
                onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </select>
            </label>
          </div>
          <div className="list-pagination-controls">
            <button
              type="button" className="btn"
              disabled={tariffLoading.visible || totalFiltered === 0 || currentPage <= 1}
              onClick={() => setPage(Math.max(1, currentPage - 1))}
            >Anterior</button>
            <strong>Página {currentPage} de {totalPages}</strong>
            <button
              type="button" className="btn"
              disabled={tariffLoading.visible || totalFiltered === 0 || currentPage >= totalPages}
              onClick={() => setPage(Math.min(totalPages, currentPage + 1))}
            >Siguiente</button>
          </div>
        </div>
      </Card>
      {selected ? <ProductDetail product={selected} close={closeDetail} closeRef={closeRef} /> : null}
    </div>
  );
}
