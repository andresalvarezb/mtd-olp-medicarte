'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { Timeline, Note } from '@/components/ui/timeline';
import { useRole } from '@/components/layout/role-context';
import { ApiError } from '@/lib/api-client';
import { resultLabel, formatNumber } from '@/lib/labels';
import { IMPORT_MAX_FILE_BYTES } from '@/lib/config';
import {
  confirmImport,
  createImport,
  getImportBatch,
  getImportRows,
  type ImportBatch,
  type ImportBatchStatus,
  type ImportRow,
} from '@/lib/imports-api';
import { listTariffProducts } from '@/lib/tariff-annex-api';

const HISTORY_COLUMNS = [
  { label: 'Lote' },
  { label: 'Archivo' },
  { label: 'Fecha' },
  { label: 'Filas' },
  { label: 'Aceptadas' },
  { label: 'Rechazadas' },
  { label: 'Estado' },
  { label: 'Acciones' },
];

const ROW_COLUMNS = [
  { label: 'Fila' },
  { label: 'Llave' },
  { label: 'Resultado' },
  { label: 'Confirmable' },
];

const STATUS_LABELS: Record<ImportBatchStatus, string> = {
  UPLOADED: 'Recibido',
  VALIDATING: 'Validando',
  READY_TO_CONFIRM: 'Lista para confirmar',
  CONFIRMING: 'Confirmando',
  COMPLETED: 'Completada',
  FAILED: 'Fallida',
  CANCELLED: 'Cancelada',
};

const STATUS_PILL: Record<ImportBatchStatus, string> = {
  UPLOADED: 'pill gray',
  VALIDATING: 'pill blue',
  READY_TO_CONFIRM: 'pill orange',
  CONFIRMING: 'pill purple',
  COMPLETED: 'pill green',
  FAILED: 'pill red',
  CANCELLED: 'pill gray',
};

const ACTIVE_STATUSES: ImportBatchStatus[] = ['UPLOADED', 'VALIDATING', 'CONFIRMING'];
const POLL_INTERVAL_MS = 1500;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' });
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

function downloadTemplate(): void {
  const headers = [
    'NUMERO_AUTORIZACION',
    'CODIGO_COMERCIAL',
    'ESTADO_AUTORIZACION',
    'NUMERO_PRESCRIPCION',
    'NOMBRE_PACIENTE',
    'IDENTIFICACION_PACIENTE',
  ];
  const content = `${headers.join(',')}\n`;
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'plantilla-autorizaciones.csv';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function CargasView() {
  const { organizationId } = useRole();

  const [batches, setBatches] = useState<ImportBatch[]>([]);
  const [rowsByBatch, setRowsByBatch] = useState<Record<string, ImportRow[]>>({});
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [tariffAvailable, setTariffAvailable] = useState<boolean | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const idempotencyKeys = useRef(new Map<string, string>());
  const rowsRequested = useRef(new Set<string>());

  useEffect(() => {
    const controller = new AbortController();
    void listTariffProducts(organizationId, { active: 'true', limit: 1 }, controller.signal)
      .then((page) => setTariffAvailable(page.items.length > 0))
      .catch(() => setTariffAvailable(null));
    return () => controller.abort();
  }, [organizationId]);

  const activeBatch = useMemo(
    () => batches.find((batch) => batch.id === selectedBatchId) ?? null,
    [batches, selectedBatchId],
  );

  const updateBatch = useCallback((updated: ImportBatch) => {
    setBatches((previous) => previous.map((batch) => (batch.id === updated.id ? updated : batch)));
  }, []);

  const loadRows = useCallback(
    async (batchId: string) => {
      if (rowsRequested.current.has(batchId)) return;
      rowsRequested.current.add(batchId);
      try {
        const page = await getImportRows(batchId, organizationId, { limit: 50 });
        setRowsByBatch((previous) => ({ ...previous, [batchId]: page.items }));
      } catch {
        rowsRequested.current.delete(batchId);
      }
    },
    [organizationId],
  );

  // Sondeo del lote activo mientras avanza el procesamiento asíncrono.
  useEffect(() => {
    if (!activeBatch || !ACTIVE_STATUSES.includes(activeBatch.status)) return;
    const tick = async () => {
      try {
        const fresh = await getImportBatch(activeBatch.id, organizationId);
        updateBatch(fresh);
        if (fresh.status === 'READY_TO_CONFIRM' || fresh.status === 'COMPLETED')
          void loadRows(fresh.id);
      } catch {
        // el siguiente intento reintenta; errores transitorios no detienen el sondeo
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [activeBatch, organizationId, updateBatch, loadRows]);

  const acceptFile = useCallback((candidate: File) => {
    setError(null);
    if (!/\.(csv|xlsx)$/i.test(candidate.name)) {
      setError('Formato no soportado. Solo se aceptan archivos CSV o Excel (.csv, .xlsx).');
      return;
    }
    if (candidate.size > IMPORT_MAX_FILE_BYTES) {
      setError(`El archivo supera el máximo de 20 MB (recibido: ${formatBytes(candidate.size)}).`);
      return;
    }
    setFile(candidate);
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) acceptFile(selected);
    event.target.value = '';
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const dropped = event.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  };

  const handleUpload = async () => {
    if (!file || uploading || tariffAvailable !== true) return;
    setUploading(true);
    setError(null);
    const idempotencyKey = crypto.randomUUID();
    try {
      const batch = await createImport(file, organizationId, idempotencyKey);
      idempotencyKeys.current.set(batch.id, idempotencyKey);
      setBatches((previous) => [batch, ...previous]);
      setSelectedBatchId(batch.id);
      setFile(null);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.code}: ${err.message}`
          : 'No fue posible subir el archivo.',
      );
    } finally {
      setUploading(false);
    }
  };

  const handleConfirm = async (batch: ImportBatch) => {
    if (confirming) return;
    setConfirming(true);
    setError(null);
    const existingKey = idempotencyKeys.current.get(batch.id);
    const idempotencyKey = existingKey ?? crypto.randomUUID();
    idempotencyKeys.current.set(batch.id, idempotencyKey);
    try {
      const result = await confirmImport(batch.id, organizationId, idempotencyKey);
      updateBatch({
        ...batch,
        status: 'COMPLETED',
        confirmedRows: result.createdRows + result.existingRows,
        existingRows: result.existingRows,
        completedAt: result.confirmedAt,
      });
      void loadRows(batch.id);
    } catch (err) {
      if (err instanceof ApiError) setError(`${err.code}: ${err.message}`);
      else setError('No fue posible confirmar la carga.');
    } finally {
      setConfirming(false);
    }
  };

  const historyRows = batches.map((batch) => [
    <span key="id" title={batch.id}>
      {shortId(batch.id)}
    </span>,
    <span key="file" title={batch.originalFilename}>
      {batch.originalFilename}
    </span>,
    formatDate(batch.createdAt),
    formatNumber(batch.totalRows),
    formatNumber(batch.validRows),
    formatNumber(batch.rejectedRows + batch.duplicateRows),
    <span key="status" className={STATUS_PILL[batch.status]}>
      {STATUS_LABELS[batch.status]}
    </span>,
    <button key="action" type="button" className="btn" onClick={() => setSelectedBatchId(batch.id)}>
      Ver detalle
    </button>,
  ]);

  const selectedRows = activeBatch ? rowsByBatch[activeBatch.id] : undefined;
  const processing = activeBatch ? ACTIVE_STATUSES.includes(activeBatch.status) : false;

  return (
    <>
      <PageHeader
        title="Carga de autorizaciones"
        description="Los archivos pasan por staging, validación por fila y confirmación antes de afectar el proceso."
        actions={
          <button type="button" className="btn" onClick={downloadTemplate}>
            Descargar plantilla
          </button>
        }
      />
      <div className="grid two-col">
        <Card>
          <CardHead
            title="Nueva carga"
            subtitle="CSV o Excel. Máximo 20 MB por archivo."
             aside={
               <span className={tariffAvailable === false ? 'pill red' : 'pill green'}>
                 {tariffAvailable === false
                   ? 'Anexo Tarifario requerido'
                   : tariffAvailable === null
                     ? 'Verificando Anexo Tarifario…'
                     : 'Anexo Tarifario disponible'}
               </span>
             }
          />
          <CardBody>
            <div
              className={`upload-box${dragging ? ' dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
              aria-label="Zona de carga de archivo de autorizaciones"
              onClick={() => fileInputRef.current?.click()}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') fileInputRef.current?.click();
              }}
            >
              <div className="upload-icon">↑</div>
              <h4>Arrastra el archivo aquí</h4>
              <p>
                o selecciónalo desde tu equipo. El archivo no se aplicará directamente a producción.
              </p>
              <button
                type="button"
                className="btn primary"
                disabled={uploading}
                onClick={(event) => {
                  event.stopPropagation();
                  void fileInputRef.current?.click();
                }}
              >
                Seleccionar archivo
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.xlsx"
                style={{ display: 'none' }}
                onChange={handleFileChange}
              />
              {file ? (
                <p style={{ marginTop: 10 }}>
                  <strong>{file.name}</strong> — {formatBytes(file.size)}
                </p>
              ) : null}
            </div>
            {error ? (
              <div className="login-error" role="alert" style={{ marginTop: 12 }}>
                {error}
              </div>
            ) : null}
            {tariffAvailable === false ? (
              <Note>
                No es posible procesar autorizaciones porque no existe un Anexo Tarifario disponible.
                Cargue o configure el Anexo Tarifario antes de continuar.
              </Note>
            ) : null}
            <div style={{ marginTop: 14, display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="btn primary"
                 disabled={!file || uploading || tariffAvailable !== true}
                onClick={() => {
                  void handleUpload();
                }}
              >
                {uploading ? 'Subiendo…' : 'Enviar a validación'}
              </button>
              {file ? (
                <button
                  type="button"
                  className="btn"
                  disabled={uploading}
                  onClick={() => setFile(null)}
                >
                  Quitar
                </button>
              ) : null}
            </div>
            {activeBatch ? (
              <div style={{ marginTop: 16 }}>
                <h4>Lote {shortId(activeBatch.id)}</h4>
                <p>
                  <span className={STATUS_PILL[activeBatch.status]}>
                    {STATUS_LABELS[activeBatch.status]}
                  </span>{' '}
                  {activeBatch.originalFilename} — {formatBytes(activeBatch.sizeBytes)}
                </p>
                <ul className="metric-list">
                  <li className="metric-mini">
                    <span>Filas totales</span>
                    <strong>{formatNumber(activeBatch.totalRows)}</strong>
                  </li>
                  <li className="metric-mini">
                    <span>Válidas</span>
                    <strong>{formatNumber(activeBatch.validRows)}</strong>
                  </li>
                   <li className="metric-mini">
                     <span>Rechazadas</span>
                     <strong>{formatNumber(activeBatch.rejectedRows)}</strong>
                   </li>
                   <li className="metric-mini">
                     <span>Fuera del Anexo Tarifario</span>
                     <strong>{formatNumber(activeBatch.tariffRejectedRows)}</strong>
                   </li>
                  <li className="metric-mini">
                    <span>Duplicadas</span>
                    <strong>{formatNumber(activeBatch.duplicateRows)}</strong>
                  </li>
                  <li className="metric-mini">
                    <span>Ya existentes</span>
                    <strong>{formatNumber(activeBatch.existingRows)}</strong>
                  </li>
                  <li className="metric-mini">
                    <span>Confirmadas</span>
                    <strong>{formatNumber(activeBatch.confirmedRows)}</strong>
                  </li>
                </ul>
                {activeBatch.status === 'READY_TO_CONFIRM' ? (
                  <button
                    type="button"
                    className="btn primary"
                    disabled={confirming}
                    onClick={() => {
                      void handleConfirm(activeBatch);
                    }}
                  >
                    {confirming ? 'Confirmando…' : 'Confirmar carga'}
                  </button>
                ) : null}
                {activeBatch.lastErrorCode ? (
                  <Note>
                    Error del lote: <strong>{resultLabel(activeBatch.lastErrorCode)}</strong>
                  </Note>
                ) : null}
                {selectedRows && selectedRows.length > 0 ? (
                  <div style={{ marginTop: 12 }}>
                    <h4>Reporte por fila (primeras {formatNumber(selectedRows.length)})</h4>
                    <DataTable
                      columns={ROW_COLUMNS}
                      rows={selectedRows.map((row: ImportRow) => [
                        formatNumber(row.rowNumber),
                        row.authorizationKey ?? '—',
                        <span key={`${row.id}-msg`} title={row.resultMessage}>
                          {resultLabel(row.resultCode)}
                        </span>,
                        row.confirmable ? 'Sí' : 'No',
                      ])}
                      emptyIcon="↑"
                      emptyTitle="Sin filas"
                      emptyDescription="El lote no tiene filas registradas."
                      aria-label="Reporte por fila del lote"
                    />
                  </div>
                ) : null}
                {processing ? (
                  <p>Procesando lote… los totales se actualizan automáticamente.</p>
                ) : null}
              </div>
            ) : null}
            <div style={{ marginTop: 14 }}>
              <Note>
                Las llaves ya existentes se reportan para revisión humana. Solo pueden actualizarse
                si están en <strong>READY_TO_DISPENSE</strong> y no han avanzado a dispensación
                reportada.
              </Note>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHead
            title="Validaciones principales"
            subtitle="Controles previos a la confirmación."
          />
          <CardBody>
            <Timeline
              items={[
                {
                  title: 'Formato y campos obligatorios',
                  description:
                    'Incluye NUMERO_AUTORIZACION, COD_COMERCIAL y campos de negocio requeridos.',
                },
                {
                  title: 'Duplicados',
                  description: 'Dentro del archivo y contra la base de datos.',
                },
                { title: 'Clasificación', description: 'CUPS_PRINCIPAL determina PBS / NO PBS.' },
                { title: 'Confirmación', description: 'Resultado por fila y causal estable.' },
              ]}
            />
          </CardBody>
        </Card>
      </div>
      <div style={{ marginTop: 16 }}>
        <Card>
          <CardHead
            title="Historial de cargas"
            subtitle="Lotes recibidos y su resultado en esta sesión."
          />
          <DataTable
            columns={HISTORY_COLUMNS}
            rows={historyRows}
            aria-label="Historial de cargas"
            emptyIcon="↑"
            emptyTitle="No se han realizado cargas"
            emptyDescription="Los lotes procesados aparecerán aquí con sus totales y el reporte de resultados."
          />
        </Card>
      </div>
    </>
  );
}
