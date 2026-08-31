'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { KpiCard, KpiGrid } from '@/components/ui/kpi-card';
import { Card } from '@/components/ui/card';
import { Tabs } from '@/components/ui/tabs';
import { DataTable } from '@/components/ui/data-table';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import {
  listNotifications,
  retryNotification,
  type NotificationStatus,
} from '@/lib/notifications-api';

const COLUMNS = [
  { label: 'Fecha' },
  { label: 'Evento' },
  { label: 'Asunto' },
  { label: 'Destinatarios' },
  { label: 'Estado' },
  { label: 'Intentos' },
  { label: 'Acciones' },
];

const STATUS_PILL: Record<
  NotificationStatus,
  'gray' | 'blue' | 'green' | 'orange' | 'red' | 'purple'
> = {
  PENDING: 'orange',
  SENT: 'green',
  FAILED: 'red',
  SKIPPED: 'gray',
};

const STATUS_LABELS: Record<NotificationStatus, string> = {
  PENDING: 'Pendiente',
  SENT: 'Enviada',
  FAILED: 'Fallida',
  SKIPPED: 'Omitida',
};

const EVENT_LABELS: Record<string, string> = {
  AUTHORIZATION_READY_TO_DISPENSE: 'Disponibilidad (OLP/Medicarte)',
  DISPENSATION_LOCATION_ASSIGNED: 'Punto asignado (OLP)',
  DISPENSATION_LOCATION_CHANGED: 'Punto modificado (OLP)',
  EPS_DIRECTION_PENDING: 'EPS — direccionamiento',
  DAILY_OPERATIONAL_REPORT: 'Reporte diario 08:00',
};

export function NotificacionesView() {
  const { organizationId, hasPermission } = useRole();
  const [tab, setTab] = useState(0);
  const [actionError, setActionError] = useState<string | null>(null);
  const [retried, setRetried] = useState<string[]>([]);

  const canManage = hasPermission('notifications.manage');
  const filters: Array<NotificationStatus | undefined> = [undefined, 'PENDING', 'SENT', 'FAILED'];
  const filter = filters[tab];

  const { data, error, loading, reload } = useApiData(
    () => listNotifications(organizationId, filter ? { status: filter } : {}),
    [organizationId, filter],
  );

  const notifications = data?.items ?? [];
  const failed = notifications.filter((notification) => notification.status === 'FAILED').length;

  const handleRetry = async (id: string) => {
    setActionError(null);
    try {
      await retryNotification(organizationId, id);
      setRetried((previous) => [...previous, id]);
      reload();
    } catch (err) {
      setActionError(
        err instanceof Error ? err.message : 'No fue posible reintentar la notificación.',
      );
    }
  };

  const rows = notifications.map((notification) => [
    new Date(notification.createdAt).toLocaleString('es-CO', {
      dateStyle: 'short',
      timeStyle: 'short',
    }),
    EVENT_LABELS[notification.notificationType] ?? notification.notificationType,
    <span key={`subj-${notification.id}`} title={notification.subject}>
      {notification.subject}
    </span>,
    notification.recipients.join(', ') || '—',
    <span key={`st-${notification.id}`} className={`pill ${STATUS_PILL[notification.status]}`}>
      {STATUS_LABELS[notification.status]}
    </span>,
    notification.attempts,
    notification.status === 'FAILED' && canManage && !retried.includes(notification.id) ? (
      <button
        key={`retry-${notification.id}`}
        type="button"
        className="btn"
        onClick={() => {
          void handleRetry(notification.id);
        }}
      >
        Reintentar
      </button>
    ) : retried.includes(notification.id) ? (
      'Reencolada'
    ) : (
      '—'
    ),
  ]);

  return (
    <>
      <PageHeader
        title="Notificaciones operativas"
        description="Envíos transaccionales con reintentos exponenciales y trazabilidad por mensaje (Gmail message ID)."
      />
      {actionError ? (
        <div className="login-error" role="alert" style={{ marginBottom: 14 }}>
          {actionError}
        </div>
      ) : null}
      <KpiGrid columns={3}>
        <KpiCard
          label="Enviadas"
          value={notifications.filter((n) => n.status === 'SENT').length}
          foot="READY + punto aplicación"
          icon="EV"
          iconBg="#eaf8f2"
          iconColor="#16835d"
        />
        <KpiCard
          label="Pendientes"
          value={notifications.filter((n) => n.status === 'PENDING').length}
          foot="En cola de envío"
          icon="…"
          iconBg="#eef4ff"
          iconColor="#2456c7"
        />
        <KpiCard
          label="Fallidas"
          value={failed}
          foot="Reintentables"
          icon="!"
          iconBg="#fff0ee"
          iconColor="#b42318"
        />
      </KpiGrid>
      <Card>
        <Tabs
          tabs={['Todas', 'Pendientes', 'Enviadas', 'Fallidas']}
          activeTab={tab}
          onChange={setTab}
        >
          {error ? (
            <div className="login-error" role="alert" style={{ margin: '0 0 14px' }}>
              {error}
            </div>
          ) : null}
          <DataTable
            columns={COLUMNS}
            rows={loading ? undefined : rows}
            aria-label="Notificaciones"
            emptyIcon="@"
            emptyTitle={loading ? 'Cargando…' : 'No se han generado notificaciones'}
            emptyDescription={
              loading
                ? 'Consultando la API…'
                : canManage
                  ? 'Los eventos operativos (disponibilidad, punto de aplicación, EPS y reporte diario) aparecerán aquí.'
                  : 'Requiere el permiso notifications.manage para su organización.'
            }
          />
        </Tabs>
      </Card>
    </>
  );
}
