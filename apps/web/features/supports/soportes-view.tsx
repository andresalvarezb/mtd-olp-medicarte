'use client';

import { useState } from 'react';
import { BulkUpdateUpload } from '@/components/bulk-update-upload';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { useRole } from '@/components/layout/role-context';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { TablePagination } from '@/components/ui/table-pagination';
import { downloadFile, listAuthorizationItems } from '@/lib/authorization-items-api';
import { patientName, patientDocument, AUDIT_STATUS_LABELS, auditPill } from '@/lib/labels';
import type { AuthorizationItemResponse } from '@authorization/contracts';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Punto aplicación' },
  { label: 'Fecha aplicación' },
  { label: 'Estado operación' },
  { label: 'Auditoría' },
];

const OPERATION_LABELS: Record<string, string> = {
  LISTO_PARA_DISPENSAR: 'Lista para dispensar',
  DISPENSACION_REPORTADA: 'Dispensación reportada',
  DISPENSADO: 'Dispensada',
  VENCIDO: 'Vencido',
};

export function SoportesView() {
  const { organizationId, hasPermission } = useRole();
  const [tab, setTab] = useState(0);
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reported = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        operationStatus: 'DISPENSACION_REPORTADA',
        applicationDateStatus: 'PRESENTE',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const dispensed = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        operationStatus: 'DISPENSADO',
        applicationDateStatus: 'PRESENTE',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );

  const pages = [{ items: reported.items }, { items: dispensed.items }];
  const hooks = [reported, dispensed];
  const currentHook = hooks[tab] ?? reported;
  const loading = currentHook.loading;
  const error = currentHook.error;
  const canExport = hasPermission('operational_exports.create');
  const canImport = hasPermission('bulk_updates.application_date');

  const handleExport = (format: 'csv' | 'xlsx') => {
    setExporting(format);
    setActionError(null);
    void downloadFile(
      '/operational-exports/authorization-items',
      organizationId,
      `medicarte-fechas-aplicacion.${format}`,
      { operationType: 'REPORT_APPLICATION_DATE', format },
    )
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : 'No fue posible descargar la base.'),
      )
      .finally(() => setExporting(null));
  };

  const rows = ((pages[tab] ?? null)?.items ?? []).map((item) => [
    <span key="num" style={{ fontWeight: 600 }}>
      {item.numeroAutorizacion}
    </span>,
    patientDocument(item.sourceData),
    patientName(item.sourceData),
    item.lugarDispensacion ?? '—',
    item.fechaAplicacion ?? '—',
    OPERATION_LABELS[item.operationStatus ?? ''] ?? '—',
    <StatusBadge key="audit" tone={auditPill(item.auditStatus)}>
      {AUDIT_STATUS_LABELS[item.auditStatus] ?? item.auditStatus}
    </StatusBadge>,
  ]);

  return (
    <>
      <PageHeader
        title="Soportes de aplicación"
        description="Registros con fecha de aplicación reportada por MEDICARTE. Los soportes documentales continúan administrándose externamente en el Drive corporativo."
        actions={
          canExport ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={exporting !== null}
                onClick={() => handleExport('csv')}
              >
                {exporting === 'csv' ? 'Generando…' : 'Descargar base'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={exporting !== null}
                onClick={() => handleExport('xlsx')}
              >
                {exporting === 'xlsx' ? 'Generando…' : 'Descargar Excel'}
              </button>
            </>
          ) : null
        }
      />
      <Card>
        {actionError ? (
          <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
            {actionError}
          </div>
        ) : null}
        {error ? (
          <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
            {error}
          </div>
        ) : null}
        {canImport ? (
          <BulkUpdateUpload
            operationType="REPORT_APPLICATION_DATE"
            buttonLabel="Cargar fechas de aplicación"
            fileTitle="Archivo de fechas de aplicación"
            columnsHint="Columnas exactas: authorization_key, fecha_aplicacion_medicamento"
            onCompleted={() => {
              reported.reload();
              dispensed.reload();
            }}
          />
        ) : null}
        <Tabs
          tabs={['Aplicación registrada', 'Auditoría aprobada']}
          activeTab={tab}
          onChange={setTab}
        >
          <DataTable
            columns={COLUMNS}
            rows={loading ? undefined : rows}
            aria-label="Soportes de aplicación"
            emptyIcon="FA"
            emptyTitle={loading ? 'Cargando…' : 'No hay registros en este estado'}
            emptyDescription={
              loading ? 'Consultando la API…' : 'No existen registros visibles para esta etapa.'
            }
          />
          <TablePagination
            page={currentHook.page}
            hasPrev={currentHook.hasPrev}
            hasNext={currentHook.hasNext}
            onPrev={currentHook.prevPage}
            onNext={currentHook.nextPage}
          />
        </Tabs>
        <div style={{ marginTop: 12 }}>
          <Note>
            Registrar la fecha real de aplicación no afirma completitud documental ni aprueba la
            auditoría. Las transiciones existentes continúan aplicándose sin cambios.
          </Note>
        </div>
      </Card>
    </>
  );
}
