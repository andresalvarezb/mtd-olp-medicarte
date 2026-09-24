'use client';

import {
  useMemo,
  useRef,
  useState,
} from 'react';

import type {
  BulkImportJobResponse,
} from '@authorization/contracts';

import {
  Card,
  CardBody,
  CardHead,
} from '@/components/ui/card';

import {
  DataTable,
} from '@/components/ui/data-table';

import {
  PageHeader,
} from '@/components/ui/page-header';

import {
  useRole,
} from '@/components/layout/role-context';

import {
  useApiData,
} from '@/hooks/use-api-data';

import {
  confirmBulkImport,
  downloadAuthorizationTemplate,
  downloadRejectedBulkImportRows,
  listBulkImports,
  uploadAuthorizationImport,
} from '@/lib/bulk-import-api';

function downloadBlob(
  blob: Blob,
  filename: string,
) {
  const url =
    URL.createObjectURL(blob);

  const anchor =
    document.createElement('a');

  anchor.href = url;
  anchor.download = filename;
  anchor.click();

  URL.revokeObjectURL(url);
}

function rejectedCount(
  job: BulkImportJobResponse,
) {
  return Math.max(
    job.totalRows -
      job.succeededRows,
    0,
  );
}

function statusLabel(
  status: BulkImportJobResponse['status'],
) {
  const labels: Record<
    BulkImportJobResponse['status'],
    string
  > = {
    UPLOADED: 'Cargado',
    VALIDATING: 'Validando',
    READY: 'Listo',
    INVALID: 'Sin filas válidas',
    PROCESSING: 'Procesando',
    COMPLETED: 'Completado',
    PARTIALLY_COMPLETED:
      'Completado con novedades',
    FAILED: 'Fallido',
    CANCELLED: 'Cancelado',
  };

  return labels[status];
}

function formatDate(
  value: string,
) {
  return new Date(
    value,
  ).toLocaleString(
    'es-CO',
    {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    },
  );
}

export function AutorizacionesView() {
  const {
    organizationId,
    hasPermission,
  } = useRole();

  const canManage =
    hasPermission(
      'bulk_imports.manage',
    );

  const fileInput =
    useRef<HTMLInputElement>(
      null,
    );

  /*
   * uploadResult representa únicamente
   * la operación que acaba de ejecutar
   * el usuario en esta sesión.
   *
   * No se reconstruye desde el historial.
   * Por eso desaparece al recargar.
   */
  const [
    uploadResult,
    setUploadResult,
  ] =
    useState<
      BulkImportJobResponse | null
    >(null);

  /*
   * detailJob pertenece exclusivamente
   * al panel lateral del historial.
   */
  const [
    detailJob,
    setDetailJob,
  ] =
    useState<
      BulkImportJobResponse | null
    >(null);

  const [
    busy,
    setBusy,
  ] =
    useState(false);

  const [
    page,
    setPage,
  ] =
    useState(1);

  const [
    pageSize,
    setPageSize,
  ] =
    useState(10);

  const [
    error,
    setError,
  ] =
    useState<string | null>(
      null,
    );

  const jobs =
    useApiData(
      () =>
        listBulkImports(
          organizationId,
        ),
      [organizationId],
    );

  const authorizationJobs =
    useMemo(
      () =>
        (
          jobs.data?.items ??
          []
        ).filter(
          (job) =>
            job.importType ===
            'AUTHORIZATIONS',
        ),
      [jobs.data],
    );

  const totalPages =
    Math.max(
      Math.ceil(
        authorizationJobs.length /
          pageSize,
      ),
      1,
    );

  const safePage =
    Math.min(
      page,
      totalPages,
    );

  const firstVisible =
    authorizationJobs.length > 0
      ? (safePage - 1) *
          pageSize +
        1
      : 0;

  const lastVisible =
    Math.min(
      safePage * pageSize,
      authorizationJobs.length,
    );

  const pagedAuthorizationJobs =
    authorizationJobs.slice(
      (safePage - 1) * pageSize,
      safePage * pageSize,
    );

  async function downloadTemplate() {
    setError(null);

    try {
      const blob =
        await downloadAuthorizationTemplate(
          organizationId,
        );

      downloadBlob(
        blob,
        'plantilla-autorizaciones.xlsx',
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible descargar la plantilla.',
      );
    }
  }

  async function downloadRejected(
    job: BulkImportJobResponse,
  ) {
    setError(null);

    try {
      const blob =
        await downloadRejectedBulkImportRows(
          organizationId,
          job.id,
        );

      downloadBlob(
        blob,
        `auto-rechazadas-${job.id}.xlsx`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible descargar las AUTO rechazadas.',
      );
    }
  }

  async function onUpload(
    file: File | undefined,
  ) {
    if (!file) {
      return;
    }

    setBusy(true);
    setError(null);
    setUploadResult(null);

    try {
      /*
       * 1. El archivo queda persistido.
       * 2. Cada fila es validada.
       * 3. Tanto aceptadas como rechazadas
       *    permanecen registradas.
       */
      const uploaded =
        await uploadAuthorizationImport(
          organizationId,
          file,
        );

      let finalJob =
        uploaded;

      /*
       * Las filas que superan las
       * validaciones se confirman
       * automáticamente.
       */
      if (
        uploaded.status ===
        'READY'
      ) {
        finalJob =
          await confirmBulkImport(
            organizationId,
            uploaded.id,
          );
      }

      /*
       * Resultado inmediato de ESTA
       * operación. No proviene del
       * historial.
       */
      setUploadResult(
        finalJob,
      );

      jobs.reload();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'No fue posible procesar el archivo.',
      );
    } finally {
      setBusy(false);

      if (
        fileInput.current
      ) {
        fileInput.current.value =
          '';
      }
    }
  }

  return (
    <>
      <PageHeader
        title="Cargar Autorizaciones"
        description="Carga las autorizaciones mediante la plantilla. Si alguna autorización contiene un error, descarga la novedad y vuelve a subir el archivo para modificar estas novedades."
        actions={
          canManage ? (
            <>
              <button
                type="button"
                className="button"
                disabled={busy}
                onClick={() => {
                  void downloadTemplate();
                }}
              >
                Descargar plantilla
              </button>

              <button
                type="button"
                className="button primary"
                disabled={busy}
                onClick={() =>
                  fileInput.current?.click()
                }
              >
                {busy
                  ? 'Procesando…'
                  : 'Seleccionar archivo XLSX'}
              </button>

              <input
                ref={fileInput}
                hidden
                type="file"
                accept=".xlsx"
                onChange={(
                  event,
                ) => {
                  void onUpload(
                    event.target
                      .files?.[0],
                  );
                }}
              />
            </>
          ) : null
        }
      />

      {error ? (
        <div
          className="login-error"
          role="alert"
        >
          {error}
        </div>
      ) : null}

      {uploadResult ? (
        <Card>
          <CardHead
            title="Carga finalizada"
            subtitle={`${uploadResult.originalFilename} · ${formatDate(
              uploadResult.createdAt,
            )}`}
          />

          <CardBody>
            <div className="auto-import-summary">
              <div className="auto-import-metric">
                <span>
                  Procesadas
                </span>

                <strong>
                  {
                    uploadResult.totalRows
                  }
                </strong>
              </div>

              <div className="auto-import-metric success">
                <span>
                  Pasaron
                </span>

                <strong>
                  {
                    uploadResult.succeededRows
                  }
                </strong>
              </div>

              <div className="auto-import-metric danger">
                <span>
                  No pasaron
                </span>

                <strong>
                  {
                    rejectedCount(
                      uploadResult,
                    )
                  }
                </strong>
              </div>
            </div>

            {rejectedCount(
              uploadResult,
            ) > 0 ? (
              <div
                className="actions"
                style={{
                  marginTop: 20,
                  justifyContent: 'flex-end',
                }}
              >
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    void downloadRejected(
                      uploadResult,
                    );
                  }}
                >
                  Descargar rechazadas
                </button>
              </div>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      <Card className="operational-list-workspace">
<CardBody>
          <div className="operational-list-table-scope">
            <DataTable
            aria-label="Historial de cargas de autorizaciones"
            columns={[
              {
                label: 'Archivo',
              },
              {
                label: 'Fecha',
              },
              {
                label: 'Total',
              },
              {
                label: 'Pasaron',
              },
              {
                label: 'No pasaron',
              },
              {
                label: 'Estado',
              },
              {
                label: '',
              },
            ]}
            rows={
              pagedAuthorizationJobs.map(
                (job) => [
                  job.originalFilename,

                  formatDate(
                    job.createdAt,
                  ),

                  job.totalRows,

                  job.succeededRows,

                  rejectedCount(
                    job,
                  ),

                  statusLabel(
                    job.status,
                  ),

                  <button
                    key={job.id}
                    type="button"
                    className="button"
                    onClick={() =>
                      setDetailJob(
                        job,
                      )
                    }
                  >
                    Ver
                  </button>,
                ],
              )
            }
            emptyIcon="AU"
            emptyTitle="Sin cargas"
            emptyDescription="Aún no se han procesado archivos de autorizaciones."
          />
          </div>

          <div className="authorization-imports-pagination list-pagination">
            <div className="authorization-imports-pagination-summary">
              <span>
                {`Mostrando ${firstVisible}–${lastVisible} de ${authorizationJobs.length}`}
              </span>

              <label className="authorization-imports-page-size-field">
                <span>
                  Filas
                </span>

                <select
                  className="control authorization-imports-page-size"
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

            <div className="authorization-imports-pagination-controls">
              <button
                type="button"
                className="btn"
                disabled={
                  safePage <= 1 ||
                  jobs.loading
                }
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.max(
                        current - 1,
                        1,
                      ),
                  )
                }
              >
                Anterior
              </button>

              <strong>
                Página {safePage} de {totalPages}
              </strong>

              <button
                type="button"
                className="btn"
                disabled={
                  safePage >= totalPages ||
                  jobs.loading
                }
                onClick={() =>
                  setPage(
                    (current) =>
                      Math.min(
                        current + 1,
                        totalPages,
                      ),
                  )
                }
              >
                Siguiente
              </button>
            </div>
          </div>
        </CardBody>
      </Card>

      {detailJob ? (
        <div
          className="import-drawer-backdrop"
          role="presentation"
          onMouseDown={() =>
            setDetailJob(
              null,
            )
          }
        >
          <aside
            className="import-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Detalle de carga"
            onMouseDown={(
              event,
            ) =>
              event.stopPropagation()
            }
          >
            <div className="import-drawer-header">
              <div>
                <span className="import-drawer-eyebrow">
                  Autorizaciones
                </span>

                <h2>
                  Detalle de carga
                </h2>
              </div>

              <button
                type="button"
                className="import-drawer-close"
                aria-label="Cerrar detalle"
                onClick={() =>
                  setDetailJob(
                    null,
                  )
                }
              >
                ×
              </button>
            </div>

            <div className="import-drawer-file">
              <strong>
                {
                  detailJob.originalFilename
                }
              </strong>

              <span>
                {
                  formatDate(
                    detailJob.createdAt,
                  )
                }
              </span>
            </div>

            <div className="import-drawer-metrics">
              <div className="import-drawer-metric">
                <span>
                  Procesadas
                </span>

                <strong>
                  {
                    detailJob.totalRows
                  }
                </strong>
              </div>

              <div className="import-drawer-metric success">
                <span>
                  Pasaron
                </span>

                <strong>
                  {
                    detailJob.succeededRows
                  }
                </strong>
              </div>

              <div className="import-drawer-metric danger">
                <span>
                  No pasaron
                </span>

                <strong>
                  {
                    rejectedCount(
                      detailJob,
                    )
                  }
                </strong>
              </div>
            </div>

            <div className="import-drawer-info">
              <span>
                Estado
              </span>

              <strong>
                {
                  statusLabel(
                    detailJob.status,
                  )
                }
              </strong>
            </div>

            {rejectedCount(
              detailJob,
            ) > 0 ? (
              <div className="import-drawer-footer">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => {
                    void downloadRejected(
                      detailJob,
                    );
                  }}
                >
                  Descargar rechazadas
                </button>
              </div>
            ) : null}
          </aside>
        </div>
      ) : null}
    </>
  );
}
