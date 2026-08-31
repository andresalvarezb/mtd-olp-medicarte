'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import { StatusBadge } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { useRole } from '@/components/layout/role-context';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { TablePagination } from '@/components/ui/table-pagination';
import { listAuthorizationItems } from '@/lib/authorization-items-api';
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
  READY_TO_DISPENSE: 'Lista para dispensar',
  DISPENSATION_REPORTED: 'Dispensación reportada',
  DISPENSED: 'Dispensada',
  EXPIRED: 'Vencido',
};

export function SoportesView() {
  const { organizationId } = useRole();
  const [tab, setTab] = useState(0);

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
        description="Fórmula y soporte de aplicación por ítem, versionados en el Drive corporativo."
      />
      <Card>
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
                : 'La carga de soportes (Drive) todavía no expone endpoint en la API.'
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
            El flujo de carga de soportes al Drive corporativo aún no tiene endpoint público; esta
            vista muestra únicamente ítems con fecha de dispensación reportada por OLP
            (dispensación reportada y dispensadas con auditoría) en tiempo real.
          </Note>
        </div>
      </Card>
    </>
  );
}
