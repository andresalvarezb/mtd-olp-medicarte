'use client';

import { useMemo, useState } from 'react';
import type { BulkImportJobResponse, BulkImportRowResponse } from '@authorization/contracts';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { PageHeader } from '@/components/ui/page-header';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import {
  cancelBulkImport,
  confirmBulkImport,
  downloadBulkImportResult,
  downloadSchedulingTemplate,
  getBulkImportRows,
  listBulkImports,
  retryFailedBulkImport,
  uploadSchedulingImport,
} from '@/lib/bulk-import-api';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function BulkImportsView() {
  const { organizationId, hasPermission } = useRole();
  const canManage = hasPermission('bulk_imports.manage');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'ALL' | 'VALID' | 'INVALID' | 'EXECUTED' | 'FAILED'>('ALL');
  const [error, setError] = useState<string | null>(null);
  const jobs = useApiData(() => listBulkImports(organizationId), [organizationId]);
  const rows = useApiData(
    () =>
      selectedId
        ? getBulkImportRows(organizationId, selectedId, filter)
        : Promise.resolve({ items: [] as BulkImportRowResponse[] }),
    [organizationId, selectedId, filter],
  );
  const selected = useMemo(
    () => jobs.data?.items.find((job) => job.id === selectedId) ?? null,
    [jobs.data, selectedId],
  );

  async function onUpload(file: File | undefined) {
    if (!file) return;
    setError(null);
    try {
      const job = await uploadSchedulingImport(organizationId, file);
      setSelectedId(job.id);
      jobs.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible cargar el archivo');
    }
  }

  async function run(action: (id: string) => Promise<BulkImportJobResponse>) {
    if (!selectedId) return;
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
    <>
      <PageHeader
        title="Importaciones"
        description="Canal XLSX de programación. Staging no reserva ni muta hechos hasta confirmar."
        actions={
          canManage ? (
            <button
              className="button"
              type="button"
              onClick={() => {
                void downloadSchedulingTemplate(organizationId).then((blob) =>
                  triggerDownload(blob, 'plantilla-programacion-esp014.xlsx'),
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
          title="Cargar XLSX"
          subtitle="ESP014_SCHEDULING_V1. Preview antes de confirmar."
        />
        <CardBody>
          {canManage ? (
            <input
              type="file"
              accept=".xlsx"
              onChange={(event) => void onUpload(event.target.files?.[0])}
            />
          ) : (
            <p className="field-note">Solo lectura. Medicarte confirma las cargas.</p>
          )}
          {selected?.duplicateFile ? (
            <p className="field-note">Advertencia DUPLICATE_FILE: este archivo ya fue cargado.</p>
          ) : null}
        </CardBody>
      </Card>
      <div className="grid two-col">
        <Card>
          <CardHead title="Jobs" subtitle="El progreso sale del estado persistido." />
          <CardBody>
            <DataTable
              columns={[
                { label: 'Archivo' },
                { label: 'Estado' },
                { label: 'Filas' },
                { label: '' },
              ]}
              rows={(jobs.data?.items ?? []).map((job) => [
                job.originalFilename,
                job.status,
                `${job.validRows}/${job.totalRows}`,
                <button
                  key={job.id}
                  className="button"
                  type="button"
                  onClick={() => setSelectedId(job.id)}
                >
                  Ver
                </button>,
              ])}
              emptyIcon="IM"
              emptyTitle="Sin importaciones"
              emptyDescription="Sube un XLSX versionado para ver el preview."
            />
          </CardBody>
        </Card>
        <Card>
          <CardHead
            title="Preview"
            subtitle={
              selected ? `${selected.status} · ${selected.templateVersion}` : 'Selecciona un job'
            }
          />
          <CardBody>
            {selected ? (
              <>
                <p className="field-note">
                  Válidas {selected.validRows}. Inválidas {selected.invalidRows}. Duplicados{' '}
                  {selected.duplicateRows}. Crearían {selected.createRows}. Conflictos{' '}
                  {selected.conflictRows}. Éxito {selected.succeededRows}. Fallidas{' '}
                  {selected.failedRows}.
                </p>
                {canManage ? (
                  <div className="actions">
                    <button
                      className="button primary"
                      type="button"
                      onClick={() => void run((id) => confirmBulkImport(organizationId, id))}
                    >
                      Confirmar importación
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => void run((id) => retryFailedBulkImport(organizationId, id))}
                    >
                      Reintentar fallidas
                    </button>
                    <button
                      className="button"
                      type="button"
                      onClick={() => void run((id) => cancelBulkImport(organizationId, id))}
                    >
                      Cancelar
                    </button>
                  </div>
                ) : null}
                <div className="actions">
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
                </div>
              </>
            ) : null}
          </CardBody>
        </Card>
      </div>
      <Card>
        <CardHead title="Filas" subtitle="Códigos de error estables más mensaje legible." />
        <CardBody>
          <div className="actions">
            {(['ALL', 'VALID', 'INVALID', 'EXECUTED', 'FAILED'] as const).map((item) => (
              <button
                key={item}
                className={item === filter ? 'button primary' : 'button'}
                type="button"
                onClick={() => setFilter(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <DataTable
            columns={[
              { label: 'Fila' },
              { label: 'Estado' },
              { label: 'Código' },
              { label: 'Mensaje' },
            ]}
            rows={(rows.data?.items ?? []).map((row) => [
              row.rowNumber,
              `${row.validationStatus}/${row.executionStatus}`,
              row.errorCode ?? row.executionStatus,
              row.errorMessage ?? '',
            ])}
            emptyIcon="RW"
            emptyTitle="Sin filas"
            emptyDescription="El detalle aparece después de subir un archivo."
          />
        </CardBody>
      </Card>
    </>
  );
}
