'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { BulkUpdateUpload } from '@/components/bulk-update-upload';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { TablePagination } from '@/components/ui/table-pagination';
import { downloadFile, getIndicators, listAuthorizationItems } from '@/lib/authorization-items-api';
import type { AuthorizationItemResponse } from '@authorization/contracts';
import { SITE_STATUS_LABELS, patientName, patientDocument, medicationName } from '@/lib/labels';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Medicamento' },
  { label: 'Estado punto' },
  { label: 'Sede / dirección' },
  { label: 'Fecha de dispensación' },
];

function formatDispensationDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('es-CO', { dateStyle: 'medium' });
}

export function LogisticaOlpView() {
  const { organizationId, hasPermission } = useRole();
  const [exporting, setExporting] = useState<'csv' | 'xlsx' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: indicators } = useApiData(() => getIndicators(organizationId), [organizationId]);
  const list = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        operationStatus: 'READY_TO_DISPENSE',
        applicationSiteStatus: 'ASSIGNED',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const { items, loading, error, reload } = list;

  const handleExport = (format: 'csv' | 'xlsx') => {
    setExporting(format);
    setActionError(null);
    downloadFile(
      '/operational-exports/authorization-items',
      organizationId,
      `olp-dispensacion.${format}`,
      { operationType: 'REPORT_DISPENSATION_DATE', format },
    )
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : 'No fue posible exportar.'),
      )
      .finally(() => setExporting(null));
  };

  const canExport = hasPermission('operational_exports.create');
  const canReport = hasPermission('bulk_updates.dispensation_date');

  const rows = items.map((item) => [
    <span key="num" style={{ fontWeight: 600 }}>
      {item.numeroAutorizacion}
    </span>,
    patientDocument(item.sourceData),
    patientName(item.sourceData),
    medicationName(item.sourceData),
    <StatusBadge key="site" tone={item.applicationSiteStatus === 'ASSIGNED' ? 'green' : 'orange'}>
      {SITE_STATUS_LABELS[item.applicationSiteStatus]}
    </StatusBadge>,
    item.lugarDispensacion ?? '—',
    item.fechaDispensacion ? formatDispensationDate(item.fechaDispensacion) : '—',
  ]);

  return (
    <>
      <PageHeader
        title="Logística OLP"
        description="Coordinación de envíos según la dirección de aplicación definida por Medicarte y vigencias MIPRES. La base exportada solo incluye registros con punto de aplicación asignado."
        actions={
          canExport ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={exporting !== null}
                onClick={() => handleExport('csv')}
              >
                {exporting === 'csv' ? 'Generando…' : 'Exportar base (CSV)'}
              </button>
              <button
                type="button"
                className="btn"
                disabled={exporting !== null}
                onClick={() => handleExport('xlsx')}
              >
                {exporting === 'xlsx' ? 'Generando…' : 'Exportar Excel'}
              </button>
            </>
          ) : null
        }
      />
      {actionError ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {actionError}
        </div>
      ) : null}
      <KpiGrid columns={3}>
        <KpiCard
          label="Esperando punto de aplicación"
          value={indicators?.pendingDispensationLocation ?? 0}
          foot="Sin lugar definido"
          icon="ED"
          iconBg="#fff4e5"
          iconColor="#b54708"
        />
        <KpiCard
          label="Con dirección asignada"
          value={indicators?.assignedDispensationLocation ?? 0}
          foot="Listas para coordinar"
          icon="DR"
          iconBg="#eaf8f2"
          iconColor="#16835d"
        />
        <KpiCard
          label="Pendientes fecha dispensación"
          value={indicators?.pendingDispensationDate ?? 0}
          foot="Reporte operativo OLP"
          icon="AD"
          iconBg="#f3f0ff"
          iconColor="#6941c6"
        />
      </KpiGrid>
      <Card>
        {canReport ? (
          <BulkUpdateUpload
            operationType="REPORT_DISPENSATION_DATE"
            buttonLabel="Reportar fecha de dispensación (archivo)"
            fileTitle="Archivo de reporte de fecha de dispensación"
            columnsHint="Columnas requeridas: CLAVE_AUTORIZACION, FECHA_DISPENSACION (formato YYYY-MM-DD). El ítem debe tener lugar de dispensación asignado por Medicarte"
            onCompleted={reload}
          />
        ) : null}
        {error ? (
          <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
            {error}
          </div>
        ) : null}
        <DataTable
          columns={COLUMNS}
          rows={loading ? undefined : rows}
          aria-label="Logística OLP"
          emptyIcon="OL"
          emptyTitle={loading ? 'Cargando…' : 'No hay envíos por coordinar'}
          emptyDescription={
            loading
              ? 'Consultando la API…'
              : 'Los ítems con punto de aplicación asignado aparecerán aquí.'
          }
        />
        <TablePagination
          page={list.page}
          hasPrev={list.hasPrev}
          hasNext={list.hasNext}
          onPrev={list.prevPage}
          onNext={list.nextPage}
        />
      </Card>
    </>
  );
}
