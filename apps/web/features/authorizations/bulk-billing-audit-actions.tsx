'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { useRole } from '@/components/layout/role-context';
import { saveExportable } from '@/lib/exportables-api';

import {
  confirmBillingAuditBulk,
  downloadBillingAuditBulkResult,
  downloadBillingAuditBulkTemplate,
  getBillingAuditBulkJob,
  uploadBillingAuditBulk,
  type BillingAuditBulkJob,
  type BillingAuditBulkRow,
} from '@/lib/authorization-billing-audit-bulk-api';

import styles from './bulk-billing-audit-actions.module.css';

const PAGE_SIZE = 100;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

type BusyAction =
  | 'template'
  | 'upload'
  | 'confirm'
  | 'refresh'
  | 'result'
  | null;

type Props = Readonly<{
  onUpdated?: () => void;
}>;

function jobStatusLabel(status: string): string {
  switch (status) {
    case 'READY': return 'Lista para confirmar';
    case 'INVALID': return 'Sin filas válidas';
    case 'PROCESSING': return 'En procesamiento';
    case 'COMPLETED': return 'Completada';
    case 'PARTIALLY_COMPLETED': return 'Completada parcialmente';
    case 'FAILED': return 'Con errores';
    default: return status;
  }
}

function resultLabel(result: BillingAuditBulkRow['result']) {
  switch (result) {
    case 'COMPLIES': return 'Cumple';
    case 'DOES_NOT_COMPLY': return 'No cumple';
    default: return '—';
  }
}

function rowStatusLabel(status: string): string {
  switch (status) {
    case 'PENDING': return 'Válida';
    case 'SUCCEEDED': return 'Registrada';
    case 'FAILED': return 'Fallida';
    case 'SKIPPED': return 'Rechazada';
    default: return status;
  }
}

function errorLabel(row: BillingAuditBulkRow): string {
  if (row.errorCode === 'AUTO_NOT_FOUND') {
    return 'La clave AUTO no existe.';
  }

  if (row.errorCode === 'AUTO_NOT_ELIGIBLE') {
    return 'La autorización no está cerrada.';
  }

  if (row.errorCode === 'AUDIT_ALREADY_REVIEWED') {
    return 'La auditoría ya fue revisada.';
  }

  return row.errorMessage ?? '—';
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function BulkBillingAuditActions({ onUpdated }: Props) {
  const { organizationId, me, hasPermission } = useRole();

  const organizationCode = me?.organizations.find(
    (organization) => organization.id === organizationId,
  )?.code;

  const canRead =
    organizationCode === 'MTD' &&
    hasPermission('application_audits.read');

  const canManage =
    organizationCode === 'MTD' &&
    hasPermission('application_audits.manage');

  const [open, setOpen] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<BillingAuditBulkJob | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState<BusyAction>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmIntent, setConfirmIntent] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const organizationEpoch = useRef(0);

  useEffect(() => {
    organizationEpoch.current += 1;
    setOpen(false);
    setFile(null);
    setJob(null);
    setOffset(0);
    setError(null);
    setConfirmIntent(false);
  }, [organizationId]);

  useEffect(() => {
    if (!open) return;

    closeRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !busy) {
        setOpen(false);
        setConfirmIntent(false);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, busy]);

  if (!canRead && !canManage) {
    return null;
  }

  const total = job?.total_rows ?? 0;
  const counts = job?.counts;
  const pending = counts?.pending ?? 0;
  const terminal = job
    ? ['COMPLETED', 'PARTIALLY_COMPLETED', 'FAILED'].includes(job.status)
    : false;

  const canConfirm =
    canManage && job?.status === 'READY' && pending > 0;

  const hasNext = job
    ? offset + job.rows.length < total
    : false;

  function resetSelection(next: File | null) {
    setError(null);
    setConfirmIntent(false);
    setJob(null);
    setOffset(0);
    setFile(next);

    if (next && (
      !next.name.toLowerCase().endsWith('.xlsx') ||
      next.size === 0 ||
      next.size > MAX_FILE_BYTES
    )) {
      setFile(null);
      setError('Selecciona un archivo .xlsx de hasta 20 MiB.');
    }
  }

  async function downloadTemplate() {
    if (busy) return;
    setBusy('template');
    setError(null);

    try {
      const blob = await downloadBillingAuditBulkTemplate(organizationId);
      saveExportable(blob, 'plantilla-auditoria-facturacion.xlsx');
    } catch (cause) {
      setError(errorMessage(cause, 'No fue posible descargar la plantilla.'));
    } finally {
      setBusy(null);
    }
  }

  async function uploadFile() {
    if (!file || !canManage || busy) return;

    const epoch = organizationEpoch.current;
    setBusy('upload');
    setError(null);
    setJob(null);
    setConfirmIntent(false);

    try {
      const preview = await uploadBillingAuditBulk(organizationId, file);
      if (epoch !== organizationEpoch.current) return;

      setJob(preview);
      setOffset(0);
    } catch (cause) {
      if (epoch === organizationEpoch.current) {
        setError(errorMessage(cause, 'No fue posible validar el archivo.'));
      }
    } finally {
      if (epoch === organizationEpoch.current) setBusy(null);
    }
  }

  async function loadPage(nextOffset: number) {
    if (!job || busy) return;

    const epoch = organizationEpoch.current;
    setBusy('refresh');
    setError(null);

    try {
      const updated = await getBillingAuditBulkJob(
        organizationId,
        job.id,
        PAGE_SIZE,
        nextOffset,
      );
      if (epoch !== organizationEpoch.current) return;

      setJob(updated);
      setOffset(nextOffset);
    } catch (cause) {
      if (epoch === organizationEpoch.current) {
        setError(errorMessage(cause, 'No fue posible consultar el lote.'));
      }
    } finally {
      if (epoch === organizationEpoch.current) setBusy(null);
    }
  }

  async function confirmJob() {
    if (!job || !canConfirm || busy || !confirmIntent) return;

    const epoch = organizationEpoch.current;
    setBusy('confirm');
    setError(null);

    try {
      await confirmBillingAuditBulk(organizationId, job.id);
      const updated = await getBillingAuditBulkJob(
        organizationId,
        job.id,
        PAGE_SIZE,
        0,
      );
      if (epoch !== organizationEpoch.current) return;

      setJob(updated);
      setOffset(0);
      setConfirmIntent(false);

      if (['COMPLETED', 'PARTIALLY_COMPLETED'].includes(updated.status)) {
        onUpdated?.();
      }
    } catch (cause) {
      if (epoch === organizationEpoch.current) {
        setError(errorMessage(cause, 'No fue posible confirmar el lote.'));
        setConfirmIntent(false);
      }
    } finally {
      if (epoch === organizationEpoch.current) setBusy(null);
    }
  }

  async function downloadResult() {
    if (!job || !canRead || busy) return;

    const epoch = organizationEpoch.current;
    setBusy('result');
    setError(null);

    try {
      const blob = await downloadBillingAuditBulkResult(
        organizationId,
        job.id,
      );
      if (epoch !== organizationEpoch.current) return;

      saveExportable(
        blob,
        `resultado-auditoria-facturacion-${job.id.slice(0, 8)}.xlsx`,
      );
    } catch (cause) {
      if (epoch === organizationEpoch.current) {
        setError(errorMessage(cause, 'No fue posible descargar el resultado.'));
      }
    } finally {
      if (epoch === organizationEpoch.current) setBusy(null);
    }
  }

  return (
    <>
      {canRead ? (
        <button
          type="button"
          className="btn"
          disabled={busy !== null}
          onClick={() => { void downloadTemplate(); }}
        >
          {busy === 'template' ? 'Descargando…' : 'Descargar plantilla'}
        </button>
      ) : null}

      {canManage ? (
        <button
          type="button"
          className="btn primary"
          onClick={() => {
            setError(null);
            setOpen(true);
          }}
        >
          Cargar auditoría masiva
        </button>
      ) : null}

      {!open && error ? (
        <span role="alert" className={styles.headerError}>{error}</span>
      ) : null}

      {open && typeof document !== 'undefined'
        ? createPortal(
            <div className="operation-drawer-backdrop">
              <section
                className="operation-drawer wide"
                role="dialog"
                aria-modal="true"
                aria-labelledby="bulk-billing-audit-title"
              >
                <header className="operation-drawer-header">
                  <div>
                    <span>Auditoría de facturación</span>
                    <h2 id="bulk-billing-audit-title">
                      Carga masiva de auditorías
                    </h2>
                    <p>
                      Valida las autorizaciones antes de registrar
                      decisiones definitivas.
                    </p>
                  </div>

                  <button
                    ref={closeRef}
                    type="button"
                    className="operation-close"
                    aria-label="Cerrar carga masiva"
                    disabled={busy !== null}
                    onClick={() => {
                      setOpen(false);
                      setConfirmIntent(false);
                    }}
                  >
                    ×
                  </button>
                </header>

                <div className={styles.steps}>
                  <div className={styles.section}>
                    <span className={styles.stepNumber}>01</span>
                    <div>
                      <h3>Preparar archivo</h3>
                      <p>
                        Descarga la plantilla. Completa la clave AUTO,
                        el resultado y, cuando aplique, la observación.
                      </p>
                    </div>
                    {canRead ? (
                      <button
                        type="button"
                        className="btn"
                        disabled={busy !== null}
                        onClick={() => { void downloadTemplate(); }}
                      >
                        Descargar plantilla
                      </button>
                    ) : null}
                  </div>

                  <div className={styles.section}>
                    <span className={styles.stepNumber}>02</span>
                    <div className={styles.sectionContent}>
                      <h3>Cargar archivo XLSX</h3>
                      <p>
                        Tamaño máximo 20 MiB. La carga solo prepara
                        la previsualización; todavía no registra auditorías.
                      </p>

                      <div className={styles.fileRow}>
                        <input
                          ref={fileRef}
                          className={styles.fileInput}
                          type="file"
                          accept=".xlsx"
                          disabled={busy !== null || terminal}
                          aria-label="Seleccionar archivo de auditoría"
                          onChange={(event) => {
                            resetSelection(event.target.files?.[0] ?? null);
                          }}
                        />
                        <button
                          type="button"
                          className="btn primary"
                          disabled={!file || busy !== null || terminal}
                          onClick={() => { void uploadFile(); }}
                        >
                          {busy === 'upload' ? 'Validando…' : 'Validar archivo'}
                        </button>
                      </div>

                      {file ? (
                        <p className={styles.filename}>
                          Archivo seleccionado: {file.name}
                        </p>
                      ) : null}

                      {terminal ? (
                        <p className={styles.info}>
                          Para procesar otro archivo, cierra este panel
                          y abre una nueva carga.
                        </p>
                      ) : null}
                    </div>
                  </div>
                </div>

                {job ? (
                  <div className={styles.preview}>
                    <div className={styles.previewHeading}>
                      <div>
                        <span className={styles.eyebrow}>03 · Validación</span>
                        <h3>Resultado de la previsualización</h3>
                        <p>
                          Estado del lote: <strong>{jobStatusLabel(job.status)}</strong>
                        </p>
                      </div>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy !== null}
                        onClick={() => { void loadPage(offset); }}
                      >
                        {busy === 'refresh' ? 'Actualizando…' : 'Actualizar'}
                      </button>
                    </div>

                    <div className={styles.metrics}>
                      <div><span>Total</span><strong>{total}</strong></div>
                      <div><span>Pendientes</span><strong>{pending}</strong></div>
                      <div><span>Registradas</span><strong>{counts?.succeeded ?? 0}</strong></div>
                      <div><span>Fallidas</span><strong>{counts?.failed ?? 0}</strong></div>
                      <div><span>Rechazadas</span><strong>{counts?.skipped ?? 0}</strong></div>
                    </div>

                    <p className={styles.info}>
                      Solo las AUTOs con estado operacional CLOSED son elegibles.
                      Esto incluye entregas completas con aplicación pendiente.
                      PARTIALLY_ASSIGNED no equivale a una autorización cerrada.
                    </p>

                    <div className={styles.tableWrap}>
                      <table className={styles.table}>
                        <thead>
                          <tr>
                            <th>Fila</th>
                            <th>Clave AUTO</th>
                            <th>Resultado</th>
                            <th>Estado</th>
                            <th>Observación / motivo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {job.rows.map((row) => (
                            <tr key={`${row.rowNumber}-${row.authorizationKey}`}>
                              <td>{row.rowNumber}</td>
                              <td className={styles.key}>{row.authorizationKey || '—'}</td>
                              <td>{resultLabel(row.result)}</td>
                              <td>
                                <span className={
                                  row.executionStatus === 'SUCCEEDED'
                                    ? styles.statusSuccess
                                    : row.executionStatus === 'PENDING'
                                      ? styles.statusPending
                                      : styles.statusError
                                }>
                                  {rowStatusLabel(row.executionStatus)}
                                </span>
                              </td>
                              <td>
                                {row.errorCode
                                  ? errorLabel(row)
                                  : row.observation || '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className={styles.pagination}>
                      <span>
                        {total
                          ? `${offset + 1}–${Math.min(offset + job.rows.length, total)} de ${total}`
                          : 'Sin filas'}
                      </span>
                      <div className={styles.paginationButtons}>
                        <button
                          type="button"
                          className="btn"
                          disabled={offset === 0 || busy !== null}
                          onClick={() => { void loadPage(Math.max(0, offset - PAGE_SIZE)); }}
                        >
                          Anterior
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={!hasNext || busy !== null}
                          onClick={() => { void loadPage(offset + PAGE_SIZE); }}
                        >
                          Siguiente
                        </button>
                      </div>
                    </div>
                  </div>
                ) : null}

                {error ? (
                  <div role="alert" className={styles.error}>
                    {error}
                  </div>
                ) : null}

                {confirmIntent && canConfirm ? (
                  <div className={styles.warning} role="alert">
                    <strong>Confirmación definitiva</strong>
                    <p>
                      Se intentará registrar {pending} auditoría(s).
                      Cada fila se validará nuevamente en el servidor.
                      Las decisiones registradas como REVIEWED son inmutables.
                    </p>
                  </div>
                ) : null}

                {job?.status === 'INVALID' ? (
                  <p className={styles.warning}>
                    No existen filas válidas para confirmar.
                    Puedes descargar el reporte y corregir el archivo.
                  </p>
                ) : null}

                <footer className={styles.footer}>
                  <button
                    type="button"
                    className="btn"
                    disabled={busy !== null}
                    onClick={() => setOpen(false)}
                  >
                    Cerrar
                  </button>

                  {job && canRead ? (
                    <button
                      type="button"
                      className="btn"
                      disabled={busy !== null}
                      onClick={() => { void downloadResult(); }}
                    >
                      {busy === 'result' ? 'Descargando…' : 'Descargar resultado'}
                    </button>
                  ) : null}

                  {confirmIntent && canConfirm ? (
                    <>
                      <button
                        type="button"
                        className="btn"
                        disabled={busy !== null}
                        onClick={() => setConfirmIntent(false)}
                      >
                        Volver
                      </button>
                      <button
                        type="button"
                        className="btn primary"
                        disabled={busy !== null}
                        onClick={() => { void confirmJob(); }}
                      >
                        {busy === 'confirm'
                          ? 'Procesando…'
                          : 'Confirmar definitivamente'}
                      </button>
                    </>
                  ) : canConfirm ? (
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busy !== null}
                      onClick={() => setConfirmIntent(true)}
                    >
                      Confirmar {pending} auditoría(s)
                    </button>
                  ) : null}
                </footer>

                {busy ? (
                  <p role="status" className={styles.busy}>
                    {busy === 'confirm'
                      ? 'Procesando auditorías…'
                      : 'Operación en curso…'}
                  </p>
                ) : null}
              </section>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
