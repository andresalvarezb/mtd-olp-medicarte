'use client';

import { useState } from 'react';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import {
  createNotificationRecipient,
  deleteNotificationRecipient,
  listNotificationRecipients,
  type NotificationType,
  getNotificationSender,
  setNotificationSender,
} from '@/lib/notifications-api';
import { ORGANIZATION_IDS } from '@/lib/config';
import { UsersAdminSection } from '@/features/admin/users-admin';

const RECIPIENT_TYPES: Array<{
  label: string;
  hint: string;
  type: NotificationType;
  placeholder: string;
  targetOrganizationId: string;
}> = [
  {
    label: 'OLP — Disponibilidad',
    hint: 'AUTHORIZATION_READY_TO_DISPENSE',
    type: 'AUTHORIZATION_READY_TO_DISPENSE',
    placeholder: 'logistica@olp.com',
    targetOrganizationId: ORGANIZATION_IDS.MEDICARTE,
  },
  {
    label: 'OLP — Punto de aplicación',
    hint: 'DISPENSATION_LOCATION_ASSIGNED',
    type: 'DISPENSATION_LOCATION_ASSIGNED',
    placeholder: 'logistica@olp.com',
    targetOrganizationId: ORGANIZATION_IDS.OLP,
  },
  {
    label: 'OLP — Cambio de punto de aplicación',
    hint: 'DISPENSATION_LOCATION_CHANGED',
    type: 'DISPENSATION_LOCATION_CHANGED',
    placeholder: 'logistica@olp.com',
    targetOrganizationId: ORGANIZATION_IDS.OLP,
  },
  {
    label: 'EPS — Direccionamiento pendiente',
    hint: 'EPS_DIRECTION_PENDING',
    type: 'EPS_DIRECTION_PENDING',
    placeholder: 'eps@compensar.com',
    targetOrganizationId: ORGANIZATION_IDS.COMPENSAR,
  },
  {
    label: 'MTD — Dispensación reportada',
    hint: 'DISPENSATION_DATE_REPORTED',
    type: 'DISPENSATION_DATE_REPORTED',
    placeholder: 'mtd@example.com',
    targetOrganizationId: ORGANIZATION_IDS.MTD,
  },
  {
    label: 'Medicarte — Dispensación reportada',
    hint: 'DISPENSATION_DATE_REPORTED',
    type: 'DISPENSATION_DATE_REPORTED',
    placeholder: 'medicarte@example.com',
    targetOrganizationId: ORGANIZATION_IDS.MEDICARTE,
  },
  {
    label: 'MTD — Aplicación reportada',
    hint: 'APPLICATION_DATE_REPORTED',
    type: 'APPLICATION_DATE_REPORTED',
    placeholder: 'mtd@example.com',
    targetOrganizationId: ORGANIZATION_IDS.MTD,
  },
  {
    label: 'Compensar — Rechazos de cargue',
    hint: 'AUTHORIZATION_IMPORT_REJECTED',
    type: 'AUTHORIZATION_IMPORT_REJECTED',
    placeholder: 'compensar@example.com',
    targetOrganizationId: ORGANIZATION_IDS.COMPENSAR,
  },
];

function RecipientBlock({
  label,
  hint,
  type,
  placeholder,
  organizationId,
  targetOrganizationId,
}: {
  label: string;
  hint: string;
  type: NotificationType;
  placeholder: string;
  organizationId: string;
  targetOrganizationId: string;
}) {
  const { data, reload } = useApiData(
    () => listNotificationRecipients(organizationId, type),
    [organizationId, type],
  );
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const recipients = (data ?? []).filter(
    (recipient) => recipient.active && recipient.organizationId === targetOrganizationId,
  );

  const handleAdd = async () => {
    setBusy(true);
    setError(null);
    try {
      await createNotificationRecipient(organizationId, {
        notificationType: type,
        organizationId: targetOrganizationId,
        email: email.trim(),
      });
      setEmail('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible agregar el destinatario.');
    } finally {
      setBusy(false);
    }
  };

  const handleRemove = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await deleteNotificationRecipient(organizationId, id);
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible retirar el destinatario.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="config-block" style={{ marginTop: 10 }}>
      <h4>{label}</h4>
      <p>{hint}</p>
      {recipients.length ? (
        <ul style={{ margin: '6px 0', paddingLeft: 18 }}>
          {recipients.map((recipient) => (
            <li key={recipient.id} style={{ marginBottom: 4 }}>
              {recipient.email}{' '}
              <button
                type="button"
                className="btn"
                style={{ padding: '2px 8px', fontSize: 10 }}
                disabled={busy}
                onClick={() => {
                  void handleRemove(recipient.id);
                }}
              >
                Retirar
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p style={{ color: 'var(--muted)' }}>Sin destinatarios activos.</p>
      )}
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          className="control"
          placeholder={placeholder}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || !email.includes('@')}
          onClick={() => {
            void handleAdd();
          }}
        >
          Agregar
        </button>
      </div>
      {error ? (
        <div className="login-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

function SenderBlock({ organizationId }: { organizationId: string }) {
  const { data, reload } = useApiData(
    () => getNotificationSender(organizationId),
    [organizationId],
  );
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = data?.email ?? '';
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setNotificationSender(organizationId, email.trim());
      setEmail('');
      reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No fue posible guardar el remitente.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="config-block" style={{ marginTop: 10 }}>
      <h4>Remitente funcional</h4>
      <p>{current || 'Sin configurar. Se usará la configuración técnica solo como respaldo.'}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
        <input
          className="control"
          type="email"
          placeholder="notificaciones@mtd.net.co"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <button
          type="button"
          className="btn"
          disabled={busy || !email.includes('@')}
          onClick={() => void save()}
        >
          Guardar
        </button>
      </div>
      {error ? (
        <div className="login-error" role="alert" style={{ marginTop: 8 }}>
          {error}
        </div>
      ) : null}
    </div>
  );
}

export function AdministracionView() {
  const { organizationId, hasPermission } = useRole();
  const canManage = hasPermission('notifications.manage');
  const canManageUsers = hasPermission('users.manage');

  return (
    <>
      <PageHeader
        title="Administración"
        description="Configuración operativa del producto y gestión de accesos. Los cambios sensibles quedan auditados."
        actions={
          canManageUsers ? (
            <span className="pill green">Gestión de usuarios activa</span>
          ) : (
            <span className="pill orange">Requiere users.manage</span>
          )
        }
      />
      <UsersAdminSection organizationId={organizationId} enabled={canManageUsers} />
      <div className="config-grid">
        <Card>
          <CardHead
            title="Destinatarios de notificaciones"
            subtitle="Alta y baja en tiempo real vía /admin/notification-recipients."
          />
          <CardBody>
            {canManage ? (
              <>
                <SenderBlock organizationId={organizationId} />
                {RECIPIENT_TYPES.map((config) => (
                  <RecipientBlock
                    key={`${config.type}-${config.targetOrganizationId}`}
                    {...config}
                    organizationId={organizationId}
                  />
                ))}
              </>
            ) : (
              <Note>
                Tu organización no tiene el permiso notifications.manage para administrar
                destinatarios.
              </Note>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHead
            title="Google Drive corporativo"
            subtitle="Destino para nuevas cargas de soportes."
          />
          <CardBody>
            <div className="field">
              <label>ID del Drive / carpeta</label>
              <input className="control" placeholder="1AbC..." disabled />
            </div>
            <div style={{ marginTop: 12 }}>
              <Note>
                La configuración de Drive aún no expone endpoint en la API; permanece como parámetro
                de despliegue. Las referencias históricas conservan el identificador del destino
                usado originalmente.
              </Note>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Reporte diario" subtitle="Resumen del día anterior." />
          <CardBody>
            <div className="split-status">
              <div className="status-box">
                <h4>Hora de ejecución</h4>
                <p>
                  <strong style={{ fontSize: 18, color: '#172033' }}>08:00</strong>
                  <br />
                  America/Bogota
                </p>
              </div>
              <div className="status-box">
                <h4>Ventana</h4>
                <p>Día calendario inmediatamente anterior.</p>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHead title="Integraciones" subtitle="Estado esperado de servicios externos." />
          <CardBody>
            <div className="split-status">
              <div className="status-box">
                <h4>MIPRES</h4>
                <p>
                  <StatusBadge tone="green">Configurado (mock)</StatusBadge>
                </p>
              </div>
              <div className="status-box">
                <h4>Identidad</h4>
                <p>
                  <StatusBadge tone="green">Autenticación local (PostgreSQL)</StatusBadge>
                </p>
              </div>
            </div>
            <div className="split-status" style={{ marginTop: 10 }}>
              <div className="status-box">
                <h4>PostgreSQL</h4>
                <p>
                  <StatusBadge tone="green">Conectado</StatusBadge>
                </p>
              </div>
              <div className="status-box">
                <h4>Redis / BullMQ</h4>
                <p>
                  <StatusBadge tone="green">Conectado</StatusBadge>
                </p>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
