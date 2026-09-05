'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { DataTable } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { Note } from '@/components/ui/timeline';
import { useRole } from '@/components/layout/role-context';
import {
  TARIFF_IMPORT_STATUS_LABELS,
  TARIFF_ROW_RESULT_LABELS,
  tariffImportPill,
  tariffRowPill,
} from '@/lib/labels';
import {
  createTariffImport,
  createTariffProduct,
  deactivateTariffProduct,
  downloadEpsNovedades,
  getTariffImport,
  listTariffImportRows,
  listTariffImports,
  listTariffProducts,
  updateTariffProduct,
  type TariffImportBatch,
  type TariffImportRow,
  type TariffProduct,
} from '@/lib/tariff-annex-api';
import { useApiData } from '@/hooks/use-api-data';
import * as XLSX from 'xlsx';

function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadTemplate(): void {
  const headers = [
    'CODIGO_MEDICAMENTO',
    'TARIFA_UNIDAD',
    'NUMERO_EXPEDIENTE_INVIMA',
    'CONSECUTIVO_INVIMA_PRESENTACION',
    'DESCRIPCION_GENERICA_MEDICAMENTO',
    'DESCRIPCION_COMERCIAL_MEDICAMENTO',
    'LABORATORIO_MEDICAMENTO',
    'TIPO_INCLUSION_MEDICAMENTO',
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), 'Anexo Tarifario');
  const content = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const blob = new Blob([content], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  downloadBlob(blob, 'plantilla-anexo-tarifario.xlsx');
}

export function AnexoTarifarioView() {
  const { organizationId, hasPermission } = useRole();
  const canRead = hasPermission('tariff_annex.read');
  const canCreate = hasPermission('tariff_annex.create');
  const canUpdate = hasPermission('tariff_annex.update');
  const canDelete = hasPermission('tariff_annex.delete');
  const canImport = hasPermission('tariff_annex.import');
  const canExport = hasPermission('operational_exports.create');

  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const [newCode, setNewCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedImportId, setSelectedImportId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const productsQuery = useMemo(
    () => ({
      codigo: search.trim() || undefined,
      active: activeFilter === 'all' ? undefined : activeFilter,
      limit: 25,
    }),
    [search, activeFilter],
  );

  const products = useApiData(
    () => listTariffProducts(organizationId, productsQuery),
    [organizationId, productsQuery],
  );
  const imports = useApiData(
    () => listTariffImports(organizationId, { limit: 10 }),
    [organizationId, selectedImportId],
  );
  const selectedRows = useApiData(
    () =>
      selectedImportId
        ? listTariffImportRows(organizationId, selectedImportId, { limit: 50 })
        : Promise.resolve({ items: [] as TariffImportRow[], nextCursor: null }),
    [organizationId, selectedImportId],
  );

  const flash = useCallback((text: string | null, problem?: string) => {
    setMessage(text);
    setError(problem ?? null);
  }, []);

  const handleCreate = async () => {
    if (!newCode.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const result = await createTariffProduct(organizationId, newCode.trim(), newIdempotencyKey());
      setNewCode('');
      flash(
        result.resultCode === 'PRODUCT_CREATED'
          ? 'Producto agregado al Anexo Tarifario.'
          : result.resultCode === 'PRODUCT_REACTIVATED'
            ? 'Producto reactivado en el Anexo Tarifario.'
            : 'El producto ya estaba registrado y activo.',
      );
      products.reload();
      imports.reload();
    } catch (err) {
      flash(null, err instanceof Error ? err.message : 'No fue posible crear el producto.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (product: TariffProduct) => {
    setBusy(true);
    setError(null);
    try {
      if (product.active) {
        await deactivateTariffProduct(organizationId, product.id);
        flash('Producto desactivado. Las autorizaciones futuras aplicarán la regla.');
      } else {
        await updateTariffProduct(organizationId, product.id, true);
        flash('Producto activado. Se programó la revalidación de autorizaciones omitidas.');
      }
      products.reload();
    } catch (err) {
      flash(null, err instanceof Error ? err.message : 'No fue posible actualizar el producto.');
    } finally {
      setBusy(false);
    }
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const batch = await createTariffImport(organizationId, file, newIdempotencyKey());
      flash(`Cargue recibido (${batch.originalFilename}). Procesando en segundo plano.`);
      setSelectedImportId(batch.id);
      imports.reload();
      products.reload();
    } catch (err) {
      flash(null, err instanceof Error ? err.message : 'No fue posible cargar el archivo.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadNovedades = async () => {
    setBusy(true);
    setError(null);
    try {
       const { blob, filename } = await downloadEpsNovedades(organizationId, 'xlsx');
      downloadBlob(blob, filename);
      flash('Exportación de novedades EPS generada.');
    } catch (err) {
      flash(null, err instanceof Error ? err.message : 'No fue posible exportar las novedades.');
    } finally {
      setBusy(false);
    }
  };

  if (!canRead) {
    return (
      <>
        <PageHeader
          title="Anexo Tarifario"
          description="Catálogo de códigos de producto habilitados, administrado por MTD."
        />
        <Card>
          <CardBody>
            <Note>
              Tu organización no tiene el permiso tariff_annex.read para administrar el Anexo
              Tarifario. Solo MTD puede gestionarlo.
            </Note>
          </CardBody>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Anexo Tarifario"
        description="Códigos de producto habilitados para el proceso. Se cruza contra COD_COMERCIAL de las autorizaciones; un producto ausente produce la causal PRODUCT_NOT_IN_TARIFF_ANNEX."
        actions={
          canImport ? (
            <>
              <button type="button" className="btn ghost" onClick={downloadTemplate}>
                 Plantilla XLSX
              </button>
              {canExport ? (
                <>
                  <button
                    type="button"
                    className="btn ghost"
                    disabled={busy}
                    onClick={() => {
                       void handleDownloadNovedades();
                    }}
                  >
                     Novedades EPS (XLSX)
                  </button>
                </>
              ) : null}
            </>
          ) : null
        }
      />

      {message ? (
        <div className="pill green" role="status" style={{ marginBottom: 10 }}>
          {message}
        </div>
      ) : null}
      {error ? (
        <div className="login-error" role="alert" style={{ marginBottom: 10 }}>
          {error}
        </div>
      ) : null}

      <div className="config-grid">
        <Card>
          <CardHead
            title="Productos"
            subtitle="Búsqueda, activación y desactivación. La desactivación es lógica y no retroactiva."
          />
          <CardBody>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <input
                className="control"
                placeholder="Buscar por código de producto"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                className="control"
                value={activeFilter}
                onChange={(event) =>
                  setActiveFilter(event.target.value as 'all' | 'true' | 'false')
                }
              >
                <option value="all">Todos</option>
                <option value="true">Activos</option>
                <option value="false">Inactivos</option>
              </select>
            </div>

            {canCreate ? (
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  className="control"
                placeholder="Nuevo código de medicamento"
                  value={newCode}
                  onChange={(event) => setNewCode(event.target.value)}
                />
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !newCode.trim()}
                  onClick={() => {
                    void handleCreate();
                  }}
                >
                  Agregar producto
                </button>
              </div>
            ) : null}

            {products.loading ? (
              <Note>Cargando productos…</Note>
            ) : products.error ? (
              <div className="login-error" role="alert">
                {products.error}
              </div>
            ) : (
              <DataTable
                aria-label="Productos del Anexo Tarifario"
                columns={[
                  { label: 'Código' },
                  { label: 'Estado' },
                  { label: 'Creado' },
                  { label: 'Actualizado' },
                  { label: 'Acciones' },
                ]}
                rows={(products.data?.items ?? []).map((product) => [
                  <span key="code" style={{ fontFamily: 'monospace' }}>
                    {product.codigoProducto}
                  </span>,
                  <StatusBadge key="state" tone={product.active ? 'green' : 'gray'}>
                    {product.active ? 'Activo' : 'Inactivo'}
                  </StatusBadge>,
                  formatDate(product.createdAt),
                  formatDate(product.updatedAt),
                  <span key="actions" style={{ display: 'flex', gap: 6 }}>
                    {product.active
                      ? canDelete && (
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={busy}
                            onClick={() => {
                              void handleToggle(product);
                            }}
                          >
                            Desactivar
                          </button>
                        )
                      : canUpdate && (
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={busy}
                            onClick={() => {
                              void handleToggle(product);
                            }}
                          >
                            Activar
                          </button>
                        )}
                  </span>,
                ])}
                emptyIcon="§"
                emptyTitle="Sin productos"
                emptyDescription="Agrega productos individualmente o mediante un cargue masivo."
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead
            title="Cargue masivo"
            subtitle="XLSX con los ocho encabezados comerciales del Anexo. Una fila inválida no impide procesar las demás."
          />
          <CardBody>
            {canImport ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleFile(file);
                  }}
                />
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>
                  Cargar Anexo Tarifario (máx. 20 MB)
                </span>
              </div>
            ) : (
              <Note>Requiere el permiso tariff_annex.import.</Note>
            )}

            {imports.loading ? (
              <Note>Cargando cargues…</Note>
            ) : imports.error ? (
              <div className="login-error" role="alert">
                {imports.error}
              </div>
            ) : (imports.data?.items.length ?? 0) === 0 ? (
              <EmptyState
                icon="↑"
                title="Sin cargues"
                description="Los resultados de cada cargue aparecerán aquí."
              />
            ) : (
              <DataTable
                aria-label="Cargues del Anexo Tarifario"
                columns={[
                  { label: 'Archivo' },
                  { label: 'Estado' },
                  { label: 'Filas' },
                  { label: 'Creados' },
                  { label: 'Rechazados' },
                  { label: 'Fecha' },
                ]}
                rows={(imports.data?.items ?? []).map((batch) => [
                  <button
                    key="file"
                    type="button"
                    className="link"
                    onClick={() => setSelectedImportId(batch.id)}
                  >
                    {batch.originalFilename}
                  </button>,
                  <StatusBadge key="status" tone={tariffImportPill(batch.status)}>
                    {TARIFF_IMPORT_STATUS_LABELS[batch.status] ?? batch.status}
                  </StatusBadge>,
                  String(batch.totalRows),
                  String(batch.createdRows + batch.reactivatedRows),
                  String(batch.rejectedRows + batch.duplicateRows),
                  formatDate(batch.createdAt),
                ])}
                emptyIcon="↑"
                emptyTitle="Sin cargues"
                emptyDescription="Los resultados de cada cargue aparecerán aquí."
              />
            )}
          </CardBody>
        </Card>
      </div>

      {selectedImportId ? (
        <div style={{ marginTop: 16 }}>
        <Card>
          <CardHead
            title={`Resultado del cargue ${selectedImportId.slice(0, 8)}`}
            subtitle="Resultado por fila con códigos estables."
            aside={
              <button
                type="button"
                className="btn ghost"
                onClick={() => setSelectedImportId(null)}
              >
                Cerrar
              </button>
            }
          />
          <CardBody>
            <ImportDetail organizationId={organizationId} batchId={selectedImportId} />
            {selectedRows.loading ? (
              <Note>Cargando filas…</Note>
            ) : selectedRows.error ? (
              <div className="login-error" role="alert">
                {selectedRows.error}
              </div>
            ) : (
              <DataTable
                aria-label="Filas del cargue del Anexo Tarifario"
                columns={[
                  { label: 'Fila' },
                  { label: 'Código' },
                  { label: 'Resultado' },
                  { label: 'Detalle' },
                ]}
                rows={(selectedRows.data?.items ?? []).map((row) => [
                  String(row.rowNumber),
                  <span key="code" style={{ fontFamily: 'monospace' }}>
                    {row.codigoProducto ?? '—'}
                  </span>,
                  <StatusBadge key="result" tone={tariffRowPill(row.resultCode)}>
                    {TARIFF_ROW_RESULT_LABELS[row.resultCode] ?? row.resultCode}
                  </StatusBadge>,
                  row.resultMessage,
                ])}
                emptyIcon="≡"
                emptyTitle="Sin filas"
                emptyDescription="El cargue aún no registra filas procesadas."
              />
            )}
          </CardBody>
        </Card>
        </div>
      ) : null}
    </>
  );
}

function ImportDetail({ organizationId, batchId }: { organizationId: string; batchId: string }) {
  const batch = useApiData(() => getTariffImport(organizationId, batchId), [
    organizationId,
    batchId,
  ]);
  const data: TariffImportBatch | null = batch.data;
  if (!data) return null;
  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 12 }}>
      <Metric label="Estado" value={TARIFF_IMPORT_STATUS_LABELS[data.status] ?? data.status} />
      <Metric label="Total" value={String(data.totalRows)} />
      <Metric label="Creados" value={String(data.createdRows)} />
      <Metric label="Reactivados" value={String(data.reactivatedRows)} />
      <Metric label="Existentes" value={String(data.existingRows)} />
      <Metric label="Rechazados" value={String(data.rejectedRows)} />
      <Metric label="Duplicados" value={String(data.duplicateRows)} />
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ color: 'var(--muted)', fontSize: 11, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
    </div>
  );
}
