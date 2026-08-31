'use client';

import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useRole } from '@/components/layout/role-context';
import type { BulkUpdateOperationType } from '@authorization/contracts';
import {
  createBulkUpdate,
  getBulkUpdateBatch,
  getBulkUpdateRows,
  type BulkUpdateBatch,
  type BulkUpdateRow,
} from '@/lib/bulk-updates-api';
import { resultLabel, BULK_BATCH_STATUS_LABELS, formatNumber } from '@/lib/labels';
import { IMPORT_MAX_FILE_BYTES } from '@/lib/config';

const BULK_BATCH_POLL_MS = 1500;
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export interface BulkUpdateUploadProps {
  operationType: BulkUpdateOperationType;
  buttonLabel: string;
  fileTitle: string;
  columnsHint: string;
  onCompleted?: () => void;
}

export function BulkUpdateUpload({
  operationType,
  buttonLabel,
  fileTitle,
  columnsHint,
  onCompleted,
}: BulkUpdateUploadProps) {
  const [showUpload, setShowUpload] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [batch, setBatch] = useState<BulkUpdateBatch | null>(null);
  const [resultRows, setResultRows] = useState<BulkUpdateRow[]>([]);
  const [resultCodeCounts, setResultCodeCounts] = useState<Record<string, number>>({});
  const [resultCursor, setResultCursor] = useState<string | null>(null);
  const [resultPage, setResultPage] = useState(0);
  const [resultError, setResultError] = useState<string | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const { organizationId } = useRole();
  const idempotencyKeyRef = useRef<string | null>(null);

  const completedRef = useRef(onCompleted);
  completedRef.current = onCompleted;

  const loadResults = useCallback(
    async (batchId: string, cursor?: string) => {
      setLoadingResults(true);
      setResultError(null);
      try {
        const page = await getBulkUpdateRows(batchId, organizationId, 100, cursor);
        setResultRows(page.items);
        setResultCursor(page.nextCursor);
        setResultPage(cursor ? (current) => current + 1 : 0);
        setResultCodeCounts(page.resultCodeCounts);
      } catch {
        setResultError('No fue posible consultar el resultado por fila. Intente nuevamente.');
      } finally {
        setLoadingResults(false);
      }
    },
    [organizationId],
  );

  useEffect(() => {
    if (!batch || !['CARGADO', 'EN_COLA', 'PROCESANDO'].includes(batch.status)) return;
    const tick = async () => {
      try {
        const fresh = await getBulkUpdateBatch(batch.id, organizationId);
        setBatch(fresh);
        if (['COMPLETADO', 'FALLIDO'].includes(fresh.status)) {
          completedRef.current?.();
          await loadResults(fresh.id);
        }
      } catch {
        // reintenta en el siguiente ciclo
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, BULK_BATCH_POLL_MS);
    return () => clearInterval(timer);
  }, [batch, loadResults, organizationId]);

  const acceptFile = useCallback((candidate: File) => {
    setBulkError(null);
    if (!/\.(csv|xlsx)$/i.test(candidate.name)) {
      setBulkError('Formato no soportado. Solo se aceptan archivos CSV o Excel (.csv, .xlsx).');
      return;
    }
    if (candidate.size > IMPORT_MAX_FILE_BYTES) {
      setBulkError(
        `El archivo supera el máximo de 20 MB (recibido: ${formatBytes(candidate.size)}).`,
      );
      return;
    }
    setFile(candidate);
  }, []);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0];
    if (selected) acceptFile(selected);
    event.target.value = '';
  };

  const handleUpload = async () => {
    if (!file || uploading || !organizationId) return;
    setUploading(true);
    setBulkError(null);
    setResultRows([]);
    setResultCodeCounts({});
    setResultCursor(null);
    setResultPage(0);
    setResultError(null);
    idempotencyKeyRef.current = crypto.randomUUID();
    try {
      const created = await createBulkUpdate(
        operationType,
        file,
        organizationId,
        idempotencyKeyRef.current,
      );
      setBatch(created);
      setFile(null);
    } catch (err) {
      setBulkError(err instanceof Error ? err.message : 'No fue posible subir el archivo.');
    } finally {
      setUploading(false);
    }
  };

  const inputId = `bulk-file-input-${operationType}`;

  return (
    <div style={{ marginBottom: 16 }}>
      <button
        type="button"
        className="btn primary"
        onClick={() => setShowUpload((value) => !value)}
      >
        {showUpload ? 'Cerrar carga' : buttonLabel}
      </button>
      {showUpload ? (
        <>
          <div
            className="upload-box"
            role="button"
            tabIndex={0}
            style={{ marginTop: 12 }}
            onClick={() => document.getElementById(inputId)?.click()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ')
                document.getElementById(inputId)?.click();
            }}
          >
            <div className="upload-icon">↑</div>
            <h4>{fileTitle}</h4>
            <p>{columnsHint} (CSV/XLSX, máx. 20 MB).</p>
            <button
              type="button"
              className="btn primary"
              disabled={uploading}
              onClick={(event) => {
                event.stopPropagation();
                document.getElementById(inputId)?.click();
              }}
            >
              Seleccionar archivo
            </button>
            <input
              id={inputId}
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
          {bulkError ? (
            <div className="login-error" role="alert" style={{ marginTop: 12 }}>
              {bulkError}
            </div>
          ) : null}
          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn primary"
              disabled={!file || uploading}
              onClick={() => {
                void handleUpload();
              }}
            >
              {uploading ? 'Subiendo…' : 'Confirmar y procesar'}
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
        </>
      ) : null}
      {batch ? (
        <>
          <p style={{ marginTop: 10 }}>
            <strong>Lote {batch.id.slice(0, 8)}</strong> —{' '}
            {BULK_BATCH_STATUS_LABELS[batch.status] ?? batch.status} · procesadas{' '}
            {formatNumber(batch.processedRows)}/{formatNumber(batch.totalRows)} · actualizadas{' '}
            {formatNumber(batch.updatedRows)} · sin cambio {formatNumber(batch.unchangedRows)} ·
            rechazadas {formatNumber(batch.rejectedRows)}
            {batch.lastErrorCode ? ` · error: ${resultLabel(batch.lastErrorCode)}` : ''}
          </p>
          {batch.status === 'COMPLETADO' && resultRows.length ? (
            <>
              {operationType === 'REPORT_APPLICATION_DATE' ? (
                <p style={{ marginTop: 8 }}>
                  Conflictos{' '}
                  {formatNumber(
                    (resultCodeCounts.VERSION_CONFLICT ?? 0) +
                      (resultCodeCounts.OPERATION_NOT_ALLOWED ?? 0),
                  )}{' '}
                  · no encontradas{' '}
                  {formatNumber(resultCodeCounts.AUTHORIZATION_ITEM_NOT_FOUND ?? 0)} · fecha
                  inválida o vacía{' '}
                  {formatNumber(
                    (resultCodeCounts.INVALID_VALUE_FORMAT ?? 0) +
                      (resultCodeCounts.MISSING_VALUE ?? 0),
                  )}{' '}
                  · duplicadas {formatNumber(resultCodeCounts.DUPLICATE_KEY_IN_FILE ?? 0)} · fuera
                  de alcance {formatNumber(resultCodeCounts.FORBIDDEN_ITEM_SCOPE ?? 0)}
                </p>
              ) : null}
              <div className="table-wrap" style={{ marginTop: 12 }}>
                <table aria-label="Resultado por fila de fechas de aplicación">
                  <thead>
                    <tr>
                      <th>Fila</th>
                      <th>authorization_key</th>
                      <th>Resultado</th>
                      <th>Detalle</th>
                    </tr>
                  </thead>
                  <tbody>
                    {resultRows.map((row) => (
                      <tr key={row.id}>
                        <td>{formatNumber(row.rowNumber)}</td>
                        <td>{row.authorizationKey ?? '—'}</td>
                        <td>{resultLabel(row.resultCode)}</td>
                        <td>{row.resultMessage}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {resultCursor ? (
                <button
                  type="button"
                  className="btn"
                  disabled={loadingResults}
                  style={{ marginTop: 10 }}
                  onClick={() => void loadResults(batch.id, resultCursor)}
                >
                  {loadingResults ? 'Consultando…' : 'Página siguiente'}
                </button>
              ) : null}
              {resultPage > 0 ? (
                <button
                  type="button"
                  className="btn"
                  disabled={loadingResults}
                  style={{ marginTop: 10, marginLeft: 8 }}
                  onClick={() => void loadResults(batch.id)}
                >
                  Volver al inicio
                </button>
              ) : null}
            </>
          ) : null}
          {resultError ? (
            <div className="login-error" role="alert" style={{ marginTop: 12 }}>
              {resultError}{' '}
              <button
                type="button"
                className="btn"
                disabled={loadingResults}
                onClick={() => void loadResults(batch.id)}
              >
                Reintentar
              </button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
