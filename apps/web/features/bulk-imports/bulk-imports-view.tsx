'use client';

import { useMemo, useState } from 'react';
import type { BulkImportJobResponse, BulkImportRowResponse } from '@authorization/contracts';

import { Card, CardBody, CardHead } from '@/components/ui/card';

import { DataTable } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { PointScopeGuard } from '@/components/point-scope/empty-point-scope';
import { useApiData } from '@/hooks/use-api-data';

import {
  cancelBulkImport,
  confirmBulkImport,
  downloadAuthorizationTemplate,
  downloadBulkImportResult,
  downloadRejectedBulkImportRows,
  getBulkImportRows,
  listBulkImports,
  retryFailedBulkImport,
  uploadAuthorizationImport,
} from '@/lib/bulk-import-api';

const LEGACY_TEMPLATE = 'LEGACY_IMPORT_BATCH_V1';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}

function isLegacyJob(job: BulkImportJobResponse | null | undefined): boolean {
  return job?.templateVersion === LEGACY_TEMPLATE;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    UPLOADED: 'Cargada',
    VALIDATING: 'Validando',
    READY: 'Pendiente de confirmar',
    INVALID: 'Con errores',
    PROCESSING: 'Procesando',
    COMPLETED: 'Completada',
    FAILED: 'Fallida',
    CANCELLED: 'Cancelada',
  };

  return labels[status] ?? status;
}

function formatDate(value: string | null | undefined): string {
  if (!value) {
    return '—';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function rejectedCount(job: BulkImportJobResponse): number {
  return Math.max(Number(job.totalRows) - Number(job.validRows), 0);
}

export function BulkImportsView() {
  const { organizationId, hasPermission } = useRole();

  const canManage = hasPermission('bulk_imports.manage');

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [filter, setFilter] = useState<'ALL' | 'VALID' | 'INVALID' | 'EXECUTED' | 'FAILED'>('ALL');

  const [error, setError] = useState<string | null>(null);

  const jobs = useApiData(() => listBulkImports(organizationId), [organizationId]);

  const authorizationJobs = useMemo(
    () => (jobs.data?.items ?? []).filter((job) => job.importType === 'AUTHORIZATIONS'),
    [jobs.data],
  );

  const selected = useMemo(
    () => authorizationJobs.find((job) => job.id === selectedId) ?? null,
    [authorizationJobs, selectedId],
  );

  const selectedIsLegacy = isLegacyJob(selected);

  const rows = useApiData(
    () =>
      selectedId && !selectedIsLegacy
        ? getBulkImportRows(organizationId, selectedId, filter)
        : Promise.resolve({
            items: [] as BulkImportRowResponse[],
          }),
    [organizationId, selectedId, selectedIsLegacy, filter],
  );

  const selectedStatus = String(selected?.status ?? '');

  const canConfirm = Boolean(selected && !selectedIsLegacy && selectedStatus === 'READY');

  const canRetry = Boolean(selected && !selectedIsLegacy && selectedStatus === 'FAILED');

  const canCancel = Boolean(
    selected &&
      !selectedIsLegacy &&
      ['UPLOADED', 'VALIDATING', 'READY', 'PROCESSING'].includes(selectedStatus),
  );

  const hasRejectedRows = Boolean(
    selected && !selectedIsLegacy && (selected.invalidRows > 0 || selected.failedRows > 0),
  );

  async function onUpload(file: File | undefined) {
    if (!file) {
      return;
    }

    setError(null);

    try {
      const job = await uploadAuthorizationImport(organizationId, file);

      setSelectedId(job.id);

      jobs.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar el archivo');
    }
  }

  async function run(action: (id: string) => Promise<BulkImportJobResponse>) {
    if (!selectedId || selectedIsLegacy) {
      return;
    }

    setError(null);

    try {
      await action(selectedId);

      jobs.reload();
      rows.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'La operación no pudo completarse');
    }
  }

  return (
    <PointScopeGuard>
      <>
        <PageHeader
          title="Cargar Autorizaciones"
          description="Carga el archivo AUTO y consulta el historial de cargues realizados."
          actions={
            canManage ? (
              <button
                className="button"
                type="button"
                onClick={() => {
                  void downloadAuthorizationTemplate(organizationId).then((blob) =>
                    triggerDownload(blob, 'plantilla-autorizaciones.xlsx'),
                  );
                }}
              >
                Descargar plantilla
              </button>
            ) : null
          }
        />

        {error ? (
          <div className="login-error" role="alert">
            {error}
          </div>
        ) : null}

        <Card>
          <CardHead
            title="Cargar archivo AUTO"
            subtitle="Selecciona el XLSX. El archivo se valida antes de aplicar cambios."
          />

          <CardBody>
            {canManage ? (
              <label
                className="button primary"
                style={{
                  display: 'inline-flex',
                  cursor: 'pointer',
                }}
              >
                Seleccionar archivo
                <input
                  type="file"
                  accept=".xlsx"
                  hidden
                  onChange={(event) => void onUpload(event.target.files?.[0])}
                />
              </label>
            ) : (
              <p className="field-note">Modo de solo lectura.</p>
            )}

            {selected?.duplicateFile ? (
              <p
                className="field-note"
                style={{
                  marginTop: 12,
                }}
              >
                Este archivo ya había sido cargado anteriormente.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHead
            title="Historial de cargas"
            subtitle="Cargues históricos y actuales de autorizaciones."
          />

          <CardBody>
            <DataTable
              columns={[
                {
                  label: 'Archivo',
                },
                {
                  label: 'Fecha',
                },
                {
                  label: 'Estado',
                },
                {
                  label: 'Procesadas',
                },
                {
                  label: 'Pasaron',
                },
                {
                  label: 'No pasaron',
                },
                {
                  label: '',
                },
              ]}
              rows={authorizationJobs.map((job) => [
                job.originalFilename,
                formatDate(job.createdAt),
                statusLabel(String(job.status)),
                job.totalRows,
                job.validRows,
                rejectedCount(job),
                <button
                  key={job.id}
                  className="button"
                  type="button"
                  onClick={() => setSelectedId(job.id)}
                >
                  Ver
                </button>,
              ])}
              emptyIcon="AU"
              emptyTitle="Sin cargas"
              emptyDescription="No existen cargues de autorizaciones registrados."
            />
          </CardBody>
        </Card>

        {selected ? (
          <Card>
            <CardHead
              title="Resultado de la carga"
              subtitle={`${selected.originalFilename} · ${formatDate(selected.createdAt)}`}
            />

            <CardBody>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(120px, 1fr))',
                  gap: 12,
                  marginBottom: 18,
                }}
              >
                <div>
                  <div className="field-note">Estado</div>

                  <strong>{statusLabel(String(selected.status))}</strong>
                </div>

                <div>
                  <div className="field-note">Procesadas</div>

                  <strong>{selected.totalRows}</strong>
                </div>

                <div>
                  <div className="field-note">Pasaron</div>

                  <strong>{selected.validRows}</strong>
                </div>

                <div>
                  <div className="field-note">No pasaron</div>

                  <strong>{rejectedCount(selected)}</strong>
                </div>
              </div>

              {selectedIsLegacy ? (
                <p className="field-note">
                  Este registro pertenece al historial anterior al módulo operativo actual. Se
                  conserva para consulta y trazabilidad.
                </p>
              ) : null}

              {canManage && !selectedIsLegacy ? (
                <div className="actions">
                  {canConfirm ? (
                    <button
                      className="button primary"
                      type="button"
                      onClick={() => void run((id) => confirmBulkImport(organizationId, id))}
                    >
                      Confirmar carga
                    </button>
                  ) : null}

                  {canRetry ? (
                    <button
                      className="button"
                      type="button"
                      onClick={() => void run((id) => retryFailedBulkImport(organizationId, id))}
                    >
                      Reintentar fallidas
                    </button>
                  ) : null}

                  {canCancel ? (
                    <button
                      className="button"
                      type="button"
                      onClick={() => void run((id) => cancelBulkImport(organizationId, id))}
                    >
                      Cancelar
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!selectedIsLegacy ? (
                <div
                  className="actions"
                  style={{
                    marginTop: 12,
                  }}
                >
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      void downloadBulkImportResult(organizationId, selected.id).then((blob) =>
                        triggerDownload(blob, 'resultado-importacion.xlsx'),
                      );
                    }}
                  >
                    Descargar resultado
                  </button>

                  {hasRejectedRows ? (
                    <button
                      className="button"
                      type="button"
                      onClick={() => {
                        void downloadRejectedBulkImportRows(organizationId, selected.id).then(
                          (blob) => triggerDownload(blob, 'filas-rechazadas.xlsx'),
                        );
                      }}
                    >
                      Descargar rechazadas
                    </button>
                  ) : null}
                </div>
              ) : null}
            </CardBody>
          </Card>
        ) : null}

        {selected && !selectedIsLegacy ? (
          <Card>
            <CardHead
              title="Detalle de filas"
              subtitle="Resultado de validación del archivo seleccionado."
            />

            <CardBody>
              <div className="actions">
                {(
                  [
                    ['ALL', 'Todas'],
                    ['VALID', 'Válidas'],
                    ['INVALID', 'Inválidas'],
                    ['EXECUTED', 'Ejecutadas'],
                    ['FAILED', 'Fallidas'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    className={value === filter ? 'button primary' : 'button'}
                    type="button"
                    onClick={() => setFilter(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <DataTable
                columns={[
                  {
                    label: 'Fila',
                  },
                  {
                    label: 'Estado',
                  },
                  {
                    label: 'Código',
                  },
                  {
                    label: 'Mensaje',
                  },
                ]}
                rows={(rows.data?.items ?? []).map((row) => [
                  row.rowNumber,
                  `${row.validationStatus}/${row.executionStatus}`,
                  row.errorCode ?? row.executionStatus,
                  row.errorMessage ?? '',
                ])}
                emptyIcon="AU"
                emptyTitle="Sin filas"
                emptyDescription="No existen filas para el filtro seleccionado."
              />
            </CardBody>
          </Card>
        ) : null}
      </>
    </PointScopeGuard>
  );
}
