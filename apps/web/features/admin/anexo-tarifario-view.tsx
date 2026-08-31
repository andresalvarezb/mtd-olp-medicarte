'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { Note } from '@/components/ui/timeline';
import { StatusBadge } from '@/components/ui/status-badge';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { resultLabel } from '@/lib/labels';
import {
  createTariffImport,
  createTariffProduct,
  deactivateTariffProduct,
  downloadEpsNovedades,
  getTariffImport,
  getTariffImportRows,
  listTariffProducts,
  updateTariffProduct,
  type TariffImportBatch,
  type TariffImportRow,
  type TariffProduct,
  type TariffProductListResponse,
} from '@/lib/tariff-annex-api';

const IMPORT_POLL_MS = 1500;

function codeTone(resultCode: string): 'green' | 'orange' | 'red' | 'gray' {
  if (resultCode === 'PRODUCT_CREATED' || resultCode === 'PRODUCT_REACTIVATED') return 'green';
  if (resultCode === 'PRODUCT_EXISTING') return 'gray';
  if (resultCode === 'DUPLICATE_IN_FILE' || resultCode === 'INVALID_PRODUCT_CODE') return 'orange';
  return 'red';
}

export function AnexoTarifarioView() {
  const { organizationId, hasPermission } = useRole();
  const canRead = hasPermission('tariff_annex.read');
  const canCreate = hasPermission('tariff_annex.create');
  const canUpdate = hasPermission('tariff_annex.update');
  const canDelete = hasPermission('tariff_annex.delete');
  const canImport = hasPermission('tariff_annex.import');

  const [codigoFilter, setCodigoFilter] = useState('');
  const [activeFilter, setActiveFilter] = useState<'all' | 'true' | 'false'>('all');
  const [newCode, setNewCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const codigo = codigoFilter.trim();
  const fetchProducts = useCallback((): Promise<TariffProductListResponse> => {
    if (!canRead || !organizationId) return Promise.resolve({ items: [], nextCursor: null });
    return listTariffProducts(organizationId, {
      ...(codigo ? { codigo } : {}),
      ...(activeFilter === 'all' ? {} : { active: activeFilter }),
    });
  }, [canRead, organizationId, codigo, activeFilter]);

  const { data, reload } = useApiData<TariffProductListResponse>(fetchProducts, [fetchProducts]);

  const [lastImportId, setLastImportId] = useState<string | null>(null);
  const [importBatch, setImportBatch] = useState<TariffImportBatch | null>(null);
  const [importRows, setImportRows] = useState<TariffImportRow[]>([]);

  const refreshImport = useCallback(
    async (importId: string): Promise<boolean> => {
      if (!canRead) return false;
      try {
        const batch = await getTariffImport(organizationId, importId);
        setImportBatch(batch);
        if (batch.status === 'COMPLETADO' || batch.status === 'FALLIDO') {
          const rows = await getTariffImportRows(organizationId, importId);
          setImportRows(rows.items);
          return true;
        }
        return false;
      } catch {
        return false;
      }
    },
    [canRead, organizationId],
  );

  useEffect(() => {
    if (!lastImportId) return;
    let cancelled = false;
    let finished = false;
    const poll = async () => {
      if (cancelled || finished) return;
      const done = await refreshImport(lastImportId);
      if (done) finished = true;
    };
    void poll();
    const timer = setInterval(() => void poll(), IMPORT_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lastImportId, refreshImport]);

  const handleCreate = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await createTariffProduct(organizationId, newCode);
      setNotice(
        result.resultCode === 'PRODUCT_CREATED'
          ? `Producto ${result.product.codigoProducto} agregado al Anexo Tarifario.`
          : result.resultCode === 'PRODUCT_REACTIVATED'
            ? `Producto ${result.product.codigoProducto} reactivado.`
            : `El producto ${result.product.codigoProducto} ya se encontraba registrado.`,
      );
      setNewCode('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible crear el producto.');
    } finally {
      setBusy(false);
    }
  };

  const handleToggle = async (product: TariffProduct) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      if (product.active && canDelete) {
        await deactivateTariffProduct(organizationId, product.id);
        setNotice(`Producto ${product.codigoProducto} desactivado (baja lógica).`);
      } else if (!product.active && canUpdate) {
        await updateTariffProduct(organizationId, product.id, true);
        setNotice(`Producto ${product.codigoProducto} reactivado.`);
      }
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible actualizar el producto.');
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async (file: File) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const batch = await createTariffImport(organizationId, file);
      setLastImportId(batch.id);
      setImportBatch(batch);
      setImportRows([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible cargar el archivo.');
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownloadEps = async (format: 'csv' | 'xlsx') => {
    setBusy(true);
    setError(null);
    try {
      await downloadEpsNovedades(organizationId, format);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible descargar la base.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    // Contrato mapeado del cargue (SPEC-014/DEC-019): misma estructura del
    // formato comercial; los códigos se cargan como TEXTO en la hoja de cálculo.
    const blob = new Blob(
      ['Código Interno Medicamento,Tarifa de la unidad Farmacéutica,Número de Expediente del INVIMA,Consecutivo INVIMA (Presentación),Descripción Genérica del Medicamento (DCI),Descripción Comercial del Medicamento,Laboratorio del Medicamento,Tipo de Inclusion del Medicamento (PBS/NOPBS)'],
      { type: 'text/csv;charset=utf-8' }
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'anexo-tarifario-plantilla.csv';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (!canRead) {
    return (
      <>
        <PageHeader
          title="Anexo Tarifario"
          description="Configuración de los productos válidos para la dispensación."
        />
        <Note>
          Tu organización no tiene permiso para consultar el Anexo Tarifario. Esta vista está
          reservada a MTD con permiso administrativo.
        </Note>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Anexo Tarifario"
        description="Define los códigos de producto válidos para que una autorización alcance el estado listo para dispensar. Cada cambio queda auditado y dispara la revalidación de autorizaciones pendientes."
      />
      {notice ? (
        <div style={{ marginBottom: 12 }}>
          <StatusBadge tone="green">{notice}</StatusBadge>
        </div>
      ) : null}
      {error ? (
        <div className="login-error" role="alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      ) : null}

      <div className="config-grid">
        <Card>
          <CardHead
            title="Crear producto"
            subtitle="Código de producto (COD_COMERCIAL). Crear un producto existente es idempotente; reactivar uno inactivo revalida autorizaciones."
          />
          <CardBody>
            {canCreate ? (
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="control"
                  placeholder="Código del producto"
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
                  Agregar
                </button>
              </div>
            ) : (
              <Note>Requiere el permiso tariff_annex.create.</Note>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead
            title="Cargar Anexo Tarifario"
            subtitle="CSV/XLSX con la columna codigo_producto. Máximo 20 MB. Resultado por fila con códigos estables."
          />
          <CardBody>
            {canImport ? (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void handleImport(file);
                  }}
                />
                <button type="button" className="btn" disabled={busy} onClick={downloadTemplate}>
                  Descargar plantilla
                </button>
              </div>
            ) : (
              <Note>Requiere el permiso tariff_annex.import.</Note>
            )}
            {importBatch ? (
              <div style={{ marginTop: 12 }}>
                <h4>Último cargue</h4>
                <p style={{ color: 'var(--muted)' }}>
                  Archivo: {importBatch.originalFilename} · Estado:{' '}
                   {importBatch.status === 'COMPLETADO'
                     ? 'Completado'
                     : importBatch.status === 'FALLIDO'
                      ? 'Fallido'
                      : 'Procesando'}
                  {importBatch.lastErrorCode ? ` · ${importBatch.lastErrorCode}` : ''}
                </p>
                <p>
                  Filas: {importBatch.totalRows} · Creados: {importBatch.createdRows} ·
                  Reactivados: {importBatch.reactivatedRows} · Existentes: {importBatch.existingRows} ·
                  Duplicados: {importBatch.duplicateRows} · Rechazados: {importBatch.rejectedRows}
                </p>
                {importRows.length ? (
                  <div className="table-wrap" style={{ maxHeight: 260 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Fila</th>
                          <th>codigo_producto</th>
                          <th>Resultado</th>
                          <th>Detalle</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importRows.map((row) => (
                          <tr key={row.id}>
                            <td>{row.rowNumber}</td>
                            <td>{row.codigoProducto ?? '—'}</td>
                            <td>
                              <StatusBadge tone={codeTone(row.resultCode)}>
                                {row.resultCode}
                              </StatusBadge>
                            </td>
                            <td>{resultLabel(row.resultCode)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHead
          title="Productos del Anexo Tarifario"
          subtitle="Búsqueda por código y estado. La desactivación es lógica y conserva la trazabilidad histórica."
        />
        <CardBody>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              className="control"
              placeholder="Buscar por código"
              value={codigoFilter}
              onChange={(event) => setCodigoFilter(event.target.value)}
            />
            <select
              className="control"
              value={activeFilter}
              onChange={(event) => setActiveFilter(event.target.value as 'all' | 'true' | 'false')}
            >
              <option value="all">Todos los estados</option>
              <option value="true">Activos</option>
              <option value="false">Inactivos</option>
            </select>
          </div>
          {data && data.items.length ? (
            <div className="table-wrap" style={{ maxHeight: 480 }}>
              <table>
                <thead>
                  <tr>
                    <th>Código</th>
                    <th>Estado</th>
                    <th>Versión</th>
                    <th>Creado</th>
                    <th>Actualizado</th>
                    <th>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((product) => (
                    <tr key={product.id}>
                      <td>{product.codigoProducto}</td>
                      <td>
                        <StatusBadge tone={product.active ? 'green' : 'gray'}>
                          {product.active ? 'Activo' : 'Inactivo'}
                        </StatusBadge>
                      </td>
                      <td>{product.version}</td>
                      <td>{new Date(product.createdAt).toLocaleString('es-CO')}</td>
                      <td>{new Date(product.updatedAt).toLocaleString('es-CO')}</td>
                      <td>
                        {product.active && canDelete ? (
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => {
                              void handleToggle(product);
                            }}
                          >
                            Desactivar
                          </button>
                        ) : !product.active && canUpdate ? (
                          <button
                            type="button"
                            className="btn"
                            disabled={busy}
                            onClick={() => {
                              void handleToggle(product);
                            }}
                          >
                            Reactivar
                          </button>
                        ) : (
                          '—'
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Note>Sin productos que coincidan con la búsqueda.</Note>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHead
          title="Descargar novedades EPS"
          subtitle="Base on-demand de registros que no alcanzaron el estado listo para dispensar, con todas las causales activas (CSV/XLSX)."
        />
        <CardBody>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                void handleDownloadEps('csv');
              }}
            >
              Descargar CSV
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                void handleDownloadEps('xlsx');
              }}
            >
              Descargar Excel
            </button>
          </div>
        </CardBody>
      </Card>
    </>
  );
}
