'use client';

import { useEffect, useRef, useState } from 'react';
import {
  authorizationItemDetailResponseSchema,
  confirmImportResponseSchema,
  importBatchResponseSchema,
  paginatedAuthorizationItemsResponseSchema,
  paginatedImportRowsResponseSchema,
  type AuthorizationItemDetailResponse,
  type AuthorizationItemResponse,
  type ImportBatchResponse,
  type ImportBatchStatus,
  type ImportRowResponse,
  type MeResponse,
} from '@authorization/contracts';
import type Keycloak from 'keycloak-js';
import { Button } from '@authorization/ui';

type Props = Readonly<{
  apiUrl: string;
  keycloak: Keycloak;
  profile: MeResponse;
}>;

const terminalBatchStatuses = new Set<ImportBatchStatus>([
  'READY_TO_CONFIRM',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
]);

function newIdempotencyKey(): string {
  return globalThis.crypto.randomUUID();
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'No fue posible completar la operación.';
}

export function PhaseTwoWorkspace({ apiUrl, keycloak, profile }: Props) {
  const readableOrganizations = profile.organizations.filter((organization) =>
    organization.permissions.includes('authorizations.read'),
  );
  const [organizationId, setOrganizationId] = useState(readableOrganizations[0]?.id ?? '');
  const organization = readableOrganizations.find((candidate) => candidate.id === organizationId);
  const [file, setFile] = useState<File>();
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadAttempt = useRef<{ file: File; key: string } | undefined>(undefined);
  const confirmAttempt = useRef<{ batchId: string; key: string } | undefined>(undefined);
  const [batch, setBatch] = useState<ImportBatchResponse>();
  const [batchPolling, setBatchPolling] = useState(false);
  const [batchError, setBatchError] = useState('');
  const [rows, setRows] = useState<ImportRowResponse[]>([]);
  const [rowsCursor, setRowsCursor] = useState<string | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [rowsLoaded, setRowsLoaded] = useState(false);
  const [rowsError, setRowsError] = useState('');
  const rowsRequest = useRef(0);
  const [items, setItems] = useState<AuthorizationItemResponse[]>([]);
  const [itemsCursor, setItemsCursor] = useState<string | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsLoaded, setItemsLoaded] = useState(false);
  const [itemsError, setItemsError] = useState('');
  const itemsRequest = useRef(0);
  const [selectedItem, setSelectedItem] = useState<AuthorizationItemDetailResponse>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const detailRequest = useRef(0);
  const [coverageFilter, setCoverageFilter] = useState('');
  const [message, setMessage] = useState('');
  const [uploadPending, setUploadPending] = useState(false);
  const [confirmPending, setConfirmPending] = useState(false);
  const canImport = organization?.permissions.includes('imports.create') ?? false;
  const canConfirm = organization?.permissions.includes('imports.confirm') ?? false;
  const mutationPending = uploadPending || confirmPending;

  async function apiRequest(path: string, init?: RequestInit): Promise<Response> {
    try {
      await keycloak.updateToken(30);
    } catch {
      throw new Error('La sesión expiró. Vuelve a iniciar sesión.');
    }
    if (!keycloak.token) throw new Error('La sesión no tiene un token vigente.');
    return fetch(`${apiUrl}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${keycloak.token}`,
        'x-organization-id': organizationId,
        ...(init?.headers ?? {}),
      },
      cache: 'no-store',
    });
  }

  async function loadRows(batchId: string, cursor?: string): Promise<void> {
    const requestId = ++rowsRequest.current;
    setRowsLoading(true);
    setRowsError('');
    if (!cursor) {
      setRows([]);
      setRowsCursor(null);
      setRowsLoaded(false);
    }
    try {
      const query = new URLSearchParams({ limit: '100' });
      if (cursor) query.set('cursor', cursor);
      const response = await apiRequest(`/api/v1/imports/${batchId}/rows?${query}`);
      if (!response.ok) throw new Error('No fue posible cargar el reporte de filas.');
      const result = paginatedImportRowsResponseSchema.parse(await response.json());
      if (requestId !== rowsRequest.current) return;
      setRows((current) => (cursor ? [...current, ...result.items] : result.items));
      setRowsCursor(result.nextCursor);
    } catch (error) {
      if (requestId === rowsRequest.current) setRowsError(errorMessage(error));
    } finally {
      if (requestId === rowsRequest.current) {
        setRowsLoading(false);
        setRowsLoaded(true);
      }
    }
  }

  async function loadItems(cursor?: string, filter = coverageFilter): Promise<void> {
    const requestId = ++itemsRequest.current;
    setItemsLoading(true);
    setItemsError('');
    if (!cursor) {
      setItems([]);
      setItemsCursor(null);
      setItemsLoaded(false);
    }
    try {
      const query = new URLSearchParams({ limit: '25' });
      if (filter) query.set('coverageType', filter);
      if (cursor) query.set('cursor', cursor);
      const response = await apiRequest(`/api/v1/authorization-items?${query}`);
      if (!response.ok) throw new Error('No fue posible cargar la bandeja.');
      const result = paginatedAuthorizationItemsResponseSchema.parse(await response.json());
      if (requestId !== itemsRequest.current) return;
      setItems((current) => (cursor ? [...current, ...result.items] : result.items));
      setItemsCursor(result.nextCursor);
    } catch (error) {
      if (requestId === itemsRequest.current) setItemsError(errorMessage(error));
    } finally {
      if (requestId === itemsRequest.current) {
        setItemsLoading(false);
        setItemsLoaded(true);
      }
    }
  }

  useEffect(() => {
    rowsRequest.current += 1;
    itemsRequest.current += 1;
    detailRequest.current += 1;
    setBatch(undefined);
    setBatchError('');
    setRows([]);
    setRowsCursor(null);
    setRowsLoaded(false);
    setRowsError('');
    setSelectedItem(undefined);
    setDetailError('');
    confirmAttempt.current = undefined;
  }, [organizationId]);

  useEffect(() => {
    if (!organization) return;
    void loadItems(undefined, coverageFilter);
  }, [organizationId, coverageFilter]);

  useEffect(() => {
    if (!batch || terminalBatchStatuses.has(batch.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function poll(): Promise<void> {
      setBatchPolling(true);
      try {
        const response = await apiRequest(`/api/v1/imports/${batch!.id}`);
        if (!response.ok) throw new Error('No fue posible consultar el progreso.');
        const result = importBatchResponseSchema.parse(await response.json());
        if (cancelled) return;
        setBatch(result);
        setBatchError('');
        if (terminalBatchStatuses.has(result.status)) {
          setBatchPolling(false);
          void loadRows(result.id);
          return;
        }
      } catch (error) {
        if (!cancelled) setBatchError(errorMessage(error));
      } finally {
        if (!cancelled) setBatchPolling(false);
      }
      if (!cancelled) timer = setTimeout(() => void poll(), 1000);
    }
    timer = setTimeout(() => void poll(), 300);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [batch?.id, batch?.status]);

  async function upload(): Promise<void> {
    if (!file) {
      setMessage('Selecciona un archivo CSV o XLSX.');
      return;
    }
    const attempt =
      uploadAttempt.current?.file === file
        ? uploadAttempt.current
        : { file, key: newIdempotencyKey() };
    uploadAttempt.current = attempt;
    setUploadPending(true);
    setMessage('');
    try {
      const body = new FormData();
      body.set('file', file);
      const response = await apiRequest('/api/v1/imports', {
        method: 'POST',
        body,
        headers: { 'idempotency-key': attempt.key },
      });
      if (!response.ok) throw new Error(`La carga fue rechazada (${response.status}).`);
      const createdBatch = importBatchResponseSchema.parse(await response.json());
      setBatch(createdBatch);
      setBatchError('');
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
      uploadAttempt.current = undefined;
      setRows([]);
      setRowsCursor(null);
      setRowsLoaded(false);
      setRowsError('');
      if (terminalBatchStatuses.has(createdBatch.status)) void loadRows(createdBatch.id);
      setMessage('Archivo recibido. El worker está validando las filas.');
    } catch (error) {
      setMessage(`${errorMessage(error)} Puedes reintentar; se conservará la clave de esta carga.`);
    } finally {
      setUploadPending(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!batch) return;
    const attempt =
      confirmAttempt.current?.batchId === batch.id
        ? confirmAttempt.current
        : { batchId: batch.id, key: newIdempotencyKey() };
    confirmAttempt.current = attempt;
    setConfirmPending(true);
    setMessage('');
    try {
      const response = await apiRequest(`/api/v1/imports/${batch.id}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'idempotency-key': attempt.key },
        body: '{}',
      });
      if (!response.ok) throw new Error(`La confirmación fue rechazada (${response.status}).`);
      const confirmed = confirmImportResponseSchema.parse(await response.json());
      const batchResponse = await apiRequest(`/api/v1/imports/${batch.id}`);
      if (!batchResponse.ok)
        throw new Error('La confirmación terminó, pero no fue posible recargar el lote.');
      const canonicalBatch = importBatchResponseSchema.parse(await batchResponse.json());
      setBatch(canonicalBatch);
      setBatchError('');
      await Promise.all([loadRows(batch.id), loadItems(undefined, coverageFilter)]);
      confirmAttempt.current = undefined;
      setMessage(`${confirmed.createdRows} filas confirmadas. La bandeja fue actualizada.`);
    } catch (error) {
      setMessage(
        `${errorMessage(error)} Puedes reintentar; se conservará la clave de esta confirmación.`,
      );
    } finally {
      setConfirmPending(false);
    }
  }

  async function openItem(itemId: string): Promise<void> {
    const requestId = ++detailRequest.current;
    setSelectedItem(undefined);
    setDetailLoading(true);
    setDetailError('');
    try {
      const response = await apiRequest(`/api/v1/authorization-items/${itemId}`);
      if (!response.ok) throw new Error('No fue posible cargar el detalle.');
      const detail = authorizationItemDetailResponseSchema.parse(await response.json());
      if (requestId === detailRequest.current) setSelectedItem(detail);
    } catch (error) {
      if (requestId === detailRequest.current) setDetailError(errorMessage(error));
    } finally {
      if (requestId === detailRequest.current) setDetailLoading(false);
    }
  }

  return (
    <section className="workspace" aria-label="Operación de Fase 2">
      <div className="workspace-header">
        <div>
          <p className="eyebrow">Fase 2 / ingesta</p>
          <h2>Bandeja de autorizaciones</h2>
        </div>
        <label className="scope-picker">
          Organización activa
          <select
            disabled={mutationPending}
            value={organizationId}
            onChange={(event) => setOrganizationId(event.target.value)}
          >
            {readableOrganizations.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {canImport ? (
        <div className="import-card" aria-busy={uploadPending || batchPolling}>
          <div>
            <p className="eyebrow">Nueva carga</p>
            <h3>Procesa CSV o XLSX sin tocar producción directamente.</h3>
            <p className="muted">
              El archivo queda temporalmente en PostgreSQL; las filas pasan por staging antes de
              confirmar.
            </p>
          </div>
          <div className="upload-controls">
            <label className="file-label" htmlFor="authorization-import-file">
              Archivo CSV o XLSX
            </label>
            <input
              ref={fileInput}
              id="authorization-import-file"
              disabled={mutationPending}
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                setFile(event.target.files?.[0]);
                uploadAttempt.current = undefined;
              }}
            />
            <Button
              disabled={mutationPending}
              className="primary compact"
              onClick={() => void upload()}
            >
              {uploadPending ? 'Cargando…' : 'Cargar archivo'}
            </Button>
          </div>
          {batch ? (
            <div className="batch-status" aria-live="polite">
              <strong>{batch.originalFilename}</strong>
              <span className={`status-pill status-${batch.status.toLowerCase()}`}>
                {batch.status}
              </span>
              <span>
                {batch.totalRows} filas · {batch.validRows} válidas · {batch.rejectedRows}{' '}
                rechazadas · {batch.duplicateRows} duplicadas · {batch.existingRows} existentes
              </span>
              {batch.status === 'CANCELLED' ? (
                <span>La carga fue cancelada y ya no se consultará su progreso.</span>
              ) : null}
              {batch.lastErrorCode ? (
                <span className="batch-error" role="alert">
                  No fue posible completar la carga. Código estable:{' '}
                  <strong>{batch.lastErrorCode}</strong>. Compártelo con soporte o vuelve a cargar
                  el archivo.
                </span>
              ) : null}
              {batchError ? (
                <span className="batch-error" role="alert">
                  {batchError} Se reintentará automáticamente.
                </span>
              ) : null}
              {canConfirm && batch.status === 'READY_TO_CONFIRM' ? (
                <Button
                  disabled={mutationPending}
                  className="secondary compact"
                  onClick={() => void confirm()}
                >
                  {confirmPending ? 'Confirmando…' : 'Confirmar válidas'}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      {batch && terminalBatchStatuses.has(batch.status) ? (
        <div className="report-card" aria-busy={rowsLoading}>
          <div className="card-heading">
            <div>
              <p className="eyebrow">Reporte de carga</p>
              <h3>Resultado por fila</h3>
            </div>
            <span>{rows.length} mostradas</span>
          </div>
          {rowsError ? (
            <div className="state-message" role="alert">
              <p>{rowsError}</p>
              <Button
                disabled={rowsLoading}
                className="secondary compact"
                onClick={() =>
                  void loadRows(batch.id, rows.length > 0 ? (rowsCursor ?? undefined) : undefined)
                }
              >
                Reintentar reporte
              </Button>
            </div>
          ) : null}
          {!rowsError && rowsLoading && !rowsLoaded ? (
            <p className="muted">Cargando filas…</p>
          ) : null}
          {!rowsError && rowsLoaded && rows.length === 0 ? (
            <p className="muted">El lote no tiene filas para mostrar.</p>
          ) : null}
          {rows.length > 0 ? (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Resultado</th>
                    <th>Llave</th>
                    <th>Clasificación</th>
                    <th>Dirección</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.rowNumber}</td>
                      <td>
                        <span className="status-pill">{row.resultCode}</span>
                        <small>{row.resultMessage}</small>
                      </td>
                      <td>{row.authorizationKey ?? 'Sin llave'}</td>
                      <td>{row.normalized?.coverageType ?? 'Sin clasificar'}</td>
                      <td>{row.normalized?.directionStatus ?? 'Sin definir'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {rowsCursor && !rowsError ? (
            <div className="pagination-control">
              <Button
                disabled={rowsLoading}
                className="secondary compact"
                onClick={() => void loadRows(batch.id, rowsCursor)}
              >
                {rowsLoading ? 'Cargando…' : 'Cargar más filas'}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="inbox-grid">
        <div className="report-card" aria-busy={itemsLoading}>
          <div className="card-heading">
            <div>
              <p className="eyebrow">Acceso autorizado</p>
              <h3>Ítems compartidos</h3>
            </div>
            <select
              disabled={mutationPending}
              aria-label="Filtrar cobertura"
              value={coverageFilter}
              onChange={(event) => setCoverageFilter(event.target.value)}
            >
              <option value="">Toda cobertura</option>
              <option value="PBS">PBS</option>
              <option value="NO_PBS">NO PBS</option>
            </select>
          </div>
          <div className="item-list">
            {itemsError ? (
              <div className="state-message" role="alert">
                <p>{itemsError}</p>
                <Button
                  disabled={itemsLoading}
                  className="secondary compact"
                  onClick={() =>
                    void loadItems(
                      items.length > 0 ? (itemsCursor ?? undefined) : undefined,
                      coverageFilter,
                    )
                  }
                >
                  Reintentar bandeja
                </Button>
              </div>
            ) : null}
            {!itemsError && itemsLoading && !itemsLoaded ? (
              <p className="muted">Cargando ítems…</p>
            ) : null}
            {items.map((item) => (
              <button className="item-row" key={item.id} onClick={() => void openItem(item.id)}>
                <span>
                  <strong>{item.authorizationKey}</strong>
                  <small>{item.codigoMedicamento}</small>
                </span>
                <span className="item-tags">
                  <span>{item.coverageType}</span>
                  <span>{item.enablementStatus}</span>
                </span>
              </button>
            ))}
            {!itemsError && itemsLoaded && items.length === 0 ? (
              <p className="muted">No hay ítems en este alcance.</p>
            ) : null}
            {itemsCursor && !itemsError ? (
              <div className="pagination-control">
                <Button
                  disabled={itemsLoading}
                  className="secondary compact"
                  onClick={() => void loadItems(itemsCursor, coverageFilter)}
                >
                  {itemsLoading ? 'Cargando…' : 'Cargar más ítems'}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
        {detailLoading ? (
          <div className="detail-card" aria-busy="true">
            <p className="muted">Cargando detalle…</p>
          </div>
        ) : null}
        {detailError ? (
          <div className="detail-card" role="alert">
            <p>{detailError}</p>
          </div>
        ) : null}
        {selectedItem ? (
          <div className="detail-card">
            <p className="eyebrow">Detalle e historial</p>
            <h3>{selectedItem.item.authorizationKey}</h3>
            <dl>
              <div>
                <dt>Cobertura</dt>
                <dd>{selectedItem.item.coverageType}</dd>
              </div>
              <div>
                <dt>Habilitación</dt>
                <dd>{selectedItem.item.enablementStatus}</dd>
              </div>
              <div>
                <dt>Dirección</dt>
                <dd>{selectedItem.item.directionStatus}</dd>
              </div>
              <div>
                <dt>Operación</dt>
                <dd>{selectedItem.item.operationStatus ?? 'Pendiente de Fase 4'}</dd>
              </div>
            </dl>
            <h4>Historial de cargas</h4>
            <ul className="history-list">
              {selectedItem.importHistory.map((entry) => (
                <li key={`${entry.batchId}-${entry.rowNumber}`}>
                  Fila {entry.rowNumber} · {entry.resultCode}
                </li>
              ))}
            </ul>
            {selectedItem.item.sourceData ? (
              <details>
                <summary>Campos fuente</summary>
                <pre>{JSON.stringify(selectedItem.item.sourceData, null, 2)}</pre>
              </details>
            ) : (
              <p className="muted">Los campos fuente sensibles requieren permiso adicional.</p>
            )}
          </div>
        ) : null}
      </div>
      {message ? (
        <p className="workspace-message" role="status">
          {message}
        </p>
      ) : null}
    </section>
  );
}
