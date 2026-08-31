'use client';

import { PageHeader } from '@/components/ui/page-header';
import { Card } from '@/components/ui/card';
import { DataTable } from '@/components/ui/data-table';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { listDeadLetterJobs } from '@/lib/notifications-api';

const COLUMNS = [
  { label: 'Job' },
  { label: 'Evento' },
  { label: 'Intentos' },
  { label: 'Último error' },
];

export function FallosRecuperablesView() {
  const { organizationId, hasPermission } = useRole();
  const canRead = hasPermission('platform.jobs.manage');

  const { data, error, loading } = useApiData(
    () => listDeadLetterJobs(organizationId),
    [organizationId],
  );

  const rows = (data ?? []).map((job) => [
    <span key={`id-${job.id}`} title={job.id}>
      {job.id.slice(0, 8)}
    </span>,
    job.eventType,
    job.attempts,
    <span key={`err-${job.id}`} title={job.lastError ?? ''}>
      {job.lastError ?? '—'}
    </span>,
  ]);

  return (
    <>
      <PageHeader
        title="Fallos recuperables"
        description="Jobs agotados en la dead-letter queue de la organización (importes, notificaciones, MIPRES)."
      />
      <Card>
        {error ? (
          <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
            {error}
          </div>
        ) : null}
        <DataTable
          columns={COLUMNS}
          rows={loading ? undefined : rows}
          aria-label="Fallos recuperables"
          emptyIcon="!"
          emptyTitle={
            loading
              ? 'Cargando…'
              : canRead
                ? 'No hay fallos pendientes'
                : 'Sin permiso para consultar fallos'
          }
          emptyDescription={
            loading
              ? 'Consultando la API…'
              : canRead
                ? 'Los jobs que agotan sus reintentos aparecen aquí para revisión manual.'
                : 'Requiere el permiso platform.jobs.manage para su organización.'
          }
        />
      </Card>
    </>
  );
}
