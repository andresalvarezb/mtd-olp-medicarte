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
const REJECTED_ROWS_SHOWN = 5;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function createIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `bulk-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
  const [rejectedRows, setRejectedRows] = useState<BulkUpdateRow[]>([]);
  const { organizationId } = useRole();
  const idempotencyKeyRef = useRef<string | null>(null);

  const completedRef = useRef(onCompleted);
  completedRef.current = onCompleted;

  useEffect(() => {
    if (!batch || !['UPLOADED', 'QUEUED', 'PROCESSING'].includes(batch.status)) return;
    const tick = async () => {
      try {
        const fresh = await getBulkUpdateBatch(batch.id, organizationId);
        setBatch(fresh);
        if (['COMPLETED', 'FAILED'].includes(fresh.status)) {
          completedRef.current?.();
          if (fresh.rejectedRows > 0) {
            const rows = await getBulkUpdateRows(fresh.id, organizationId);
            setRejectedRows(
              rows.items
                .filter((row) => !['ROW_UPDATED', 'UNCHANGED_VALUE'].includes(row.resultCode))
                .slice(0, REJECTED_ROWS_SHOWN),
            );
          } else {
            setRejectedRows([]);
          }
        }
      } catch {
        // reintenta en el siguiente ciclo
      }
    };
    const timer = setInterval(() => {
      void tick();
    }, BULK_BATCH_POLL_MS);
    return () => clearInterval(timer);
  }, [batch, organizationId]);

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
    if (!file || uploading) return;
    if (!organizationId) {
      setBulkError(
        'No fue posible identificar la organización activa. Recarga la página e inténtalo de nuevo.',
      );
      return;
    }
    setUploading(true);
    setBulkError(null);
    setRejectedRows([]);
    try {
      idempotencyKeyRef.current = createIdempotencyKey();
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
              {uploading ? 'Subiendo…' : 'Enviar archivo'}
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
          {rejectedRows.length ? (
            <ul style={{ marginTop: 6, paddingLeft: 20 }}>
              {rejectedRows.map((row) => (
                <li key={row.id}>
                  Fila {formatNumber(row.rowNumber)}: {resultLabel(row.resultCode)} —{' '}
                  {row.resultMessage}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
