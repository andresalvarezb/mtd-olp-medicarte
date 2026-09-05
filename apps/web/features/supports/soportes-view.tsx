'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { BulkUpdateUpload } from '@/components/bulk-update-upload';
import { useRole } from '@/components/layout/role-context';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { TablePagination } from '@/components/ui/table-pagination';
import { listAuthorizationItems } from '@/lib/authorization-items-api';
import { downloadFile } from '@/lib/authorization-items-api';
import {
  patientName,
  patientDocument,
  medicationName,
  medicationQuantity,
  AUDIT_STATUS_LABELS,
  auditPill,
} from '@/lib/labels';
import type { AuthorizationItemResponse } from '@authorization/contracts';

const COLUMNS = [
  { label: 'Autorización' },
  { label: 'Documento' },
  { label: 'Paciente' },
  { label: 'Cantidad' },
  { label: 'Medicamento' },
  { label: 'Punto aplicación' },
  { label: 'Fecha aplicación' },
  { label: 'Estado operación' },
  { label: 'Auditoría' },
];

const OPERATION_LABELS: Record<string, string> = {
  READY_TO_DISPENSE: 'Lista para dispensar',
  DISPENSATION_REPORTED: 'Dispensación reportada',
  DISPENSED: 'Dispensada',
  EXPIRED: 'Vencido',
};

export function SoportesView() {
  const { organizationId, hasPermission } = useRole();
  const [tab, setTab] = useState(0);
  const [exporting, setExporting] = useState<'xlsx' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reported = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        operationStatus: 'DISPENSATION_REPORTED',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );
  const dispensed = usePaginatedList<AuthorizationItemResponse>(
    (cursor) =>
      listAuthorizationItems(organizationId, {
        limit: 50,
        operationStatus: 'DISPENSED',
        ...(cursor ? { cursor } : {}),
      }),
    [organizationId],
  );

  const pages = [
    { items: reported.items.filter((item) => item.fechaDispensacion !== null) },
    { items: dispensed.items.filter((item) => item.fechaDispensacion !== null) },
    { items: dispensed.items.filter((item) => item.fechaDispensacion !== null) },
  ];
  const hooks = [reported, dispensed, dispensed];
  const currentHook = hooks[tab] ?? reported;
  const loading = currentHook.loading;
  const error = currentHook.error;
  const canExport = hasPermission('operational_exports.create');
  const canReport = hasPermission('bulk_updates.application_date');

  const handleExport = () => {
    setExporting('xlsx');
    setActionError(null);
    downloadFile(
      '/operational-exports/authorization-items',
      organizationId,
       'medicarte-fecha-aplicacion.xlsx',
       { operationType: 'REPORT_APPLICATION_DATE', format: 'xlsx' },
    )
      .catch((err: unknown) =>
        setActionError(err instanceof Error ? err.message : 'No fue posible exportar.'),
      )
      .finally(() => setExporting(null));
  };

  const rows = ((pages[tab] ?? null)?.items ?? []).map((item) => [
    <span key="num" style={{ fontWeight: 600 }}>
      {item.numeroAutorizacion}
    </span>,
    patientDocument(item.sourceData),
    patientName(item.sourceData),
    medicationQuantity(item.sourceData),
    medicationName(item.sourceData),
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
        description="Fórmula y soporte de aplicación por ítem, versionados en el Drive corporativo."
        actions={
          canExport ? (
            <>
              <button
                type="button"
                className="btn"
                disabled={exporting !== null}
                onClick={handleExport}
              >
                {exporting === 'xlsx' ? 'Generando…' : 'Exportar base (XLSX)'}
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
        {canReport ? (
          <BulkUpdateUpload
            operationType="REPORT_APPLICATION_DATE"
            buttonLabel="Reportar fecha de aplicación (archivo)"
            fileTitle="Archivo de actualización de fecha de aplicación"
            columnsHint="Columnas requeridas: CLAVE_AUTORIZACION, FECHA_APLICACION"
            onCompleted={() => {
              reported.reload();
              dispensed.reload();
            }}
          />
        ) : null}
        {error ? (
          <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
            {error}
          </div>
        ) : null}
        <Tabs
          tabs={['Dispensación reportada', 'Con soporte completo', 'Historial']}
          activeTab={tab}
          onChange={setTab}
        >
          <DataTable
            columns={COLUMNS}
            rows={loading ? undefined : rows}
            aria-label="Soportes de aplicación"
            emptyIcon="PDF"
            emptyTitle={loading ? 'Cargando…' : 'No hay registros en este estado'}
            emptyDescription={
              loading
                ? 'Consultando la API…'
                 : 'Los registros con fecha de dispensación aparecen aquí para reportar su fecha de aplicación.'
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
            Esta vista muestra ítems con fecha de dispensación reportada por OLP. Medicarte puede
            descargar la base, completar únicamente <strong>CLAVE_AUTORIZACION</strong> y
            <strong> FECHA_APLICACION</strong>, y cargarla para actualizar ese campo.
          </Note>
        </div>
      </Card>
    </>
  );
}
