'use client';

import { useState } from 'react';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { useApiData } from '@/hooks/use-api-data';
import {
  addAssignment,
  approvePendingRequest,
  createUser,
  listPendingRequests,
  listUsers,
  rejectPendingRequest,
  revokeAssignment,
  updateUser,
} from '@/lib/users-api';
import { ORGANIZATION_IDS } from '@/lib/config';
import type { PendingUserRequest, UserResponse } from '@/lib/users-api';

const ORGANIZATIONS: Array<{ id: string; code: string; label: string }> = [
  { id: ORGANIZATION_IDS.MTD, code: 'MTD', label: 'MTD — Administración' },
  { id: ORGANIZATION_IDS.COMPENSAR, code: 'COMPENSAR', label: 'Compensar — EPS' },
  { id: ORGANIZATION_IDS.OLP, code: 'OLP', label: 'OLP — Logística' },
  { id: ORGANIZATION_IDS.MEDICARTE, code: 'MEDICARTE', label: 'Medicarte — Aplicación' },
];

const ROLES: Array<{ code: string; label: string }> = [
  { code: 'MTD_ADMIN', label: 'MTD Admin' },
  { code: 'MTD_AUTORIZACIONES', label: 'MTD Autorizaciones' },
  { code: 'MTD_AUDITOR', label: 'MTD Auditoría' },
  { code: 'COMPENSAR_VIEWER', label: 'Compensar Consulta' },
  { code: 'OLP_OPERATOR', label: 'OLP Operador' },
  { code: 'MEDICARTE_OPERATOR', label: 'Medicarte Operador' },
  { code: 'READ_ONLY', label: 'Solo lectura' },
];

function roleLabel(code: string): string {
  return ROLES.find((role) => role.code === code)?.label ?? code;
}

function useUserAdminData(organizationId: string) {
  const users = useApiData(() => listUsers(organizationId), [organizationId]);
  const pending = useApiData(() => listPendingRequests(organizationId), [organizationId]);
  const reloadAll = () => {
    users.reload();
    pending.reload();
  };
  return { users: users.data, pending: pending.data, reloadAll };
}

export function UsersAdminCard({ organizationId }: { organizationId: string }) {
  const { users, pending, reloadAll } = useUserAdminData(organizationId);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Alta de usuario
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [newOrgId, setNewOrgId] = useState(ORGANIZATION_IDS.MTD);
  const [newRole, setNewRole] = useState('MTD_OPERATOR');

  // Asignación
  const [assignOrgId, setAssignOrgId] = useState(ORGANIZATION_IDS.MTD);
  const [assignRole, setAssignRole] = useState('MTD_OPERATOR');

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    void action()
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Error inesperado.'))
      .finally(() => setBusy(false));
  };

  const handleCreate = () =>
    run(async () => {
      await createUser(organizationId, {
        email: email.trim(),
        displayName: displayName.trim(),
        password,
        organizationId: newOrgId,
        roleCode: newRole,
      });
      setEmail('');
      setDisplayName('');
      setPassword('');
      reloadAll();
    });

  const handleApprove = (request: PendingUserRequest) =>
    run(async () => {
      await approvePendingRequest(organizationId, request.id, {
        organizationId: assignOrgId,
        roleCode: assignRole,
      });
      reloadAll();
    });

  const handleReject = (request: PendingUserRequest) =>
    run(async () => {
      await rejectPendingRequest(organizationId, request.id);
      reloadAll();
    });

  const handleToggleActive = (user: UserResponse) =>
    run(async () => {
      await updateUser(organizationId, user.id, { active: !user.active });
      reloadAll();
    });

  const handleAddAssignment = (user: UserResponse) =>
    run(async () => {
      await addAssignment(organizationId, user.id, {
        organizationId: assignOrgId,
        roleCode: assignRole,
      });
      reloadAll();
    });

  const handleRevoke = (user: UserResponse, targetOrganizationId: string) =>
    run(async () => {
      await revokeAssignment(organizationId, user.id, targetOrganizationId);
      reloadAll();
    });

  return (
    <div className="config-grid" style={{ marginTop: 16 }}>
      <Card>
        <CardHead
          title="Usuarios con acceso"
          subtitle="Alta, desactivación y asignaciones por organización."
        />
        <CardBody>
          {error ? (
            <div className="login-error" role="alert" style={{ marginBottom: 10 }}>
              {error}
            </div>
          ) : null}
          {users?.items.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                    <th style={{ padding: '6px 8px' }}>Usuario</th>
                    <th style={{ padding: '6px 8px' }}>Accesos</th>
                    <th style={{ padding: '6px 8px' }}>Estado</th>
                    <th style={{ padding: '6px 8px' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.items.map((user) => (
                    <tr key={user.id} style={{ borderTop: '1px solid var(--border, #e2e6ee)' }}>
                      <td style={{ padding: '8px' }}>
                        <strong>{user.displayName}</strong>
                        <br />
                        <span style={{ color: 'var(--muted)' }}>{user.email}</span>
                      </td>
                      <td style={{ padding: '8px' }}>
                        {user.assignments.filter((a) => a.active).length ? (
                          user.assignments
                            .filter((a) => a.active)
                            .map((a) => (
                              <span
                                key={`${a.organizationId}-${a.roleCode}`}
                                style={{ marginRight: 6 }}
                              >
                                <StatusBadge tone="blue">
                                  {a.organizationCode} · {roleLabel(a.roleCode)}
                                </StatusBadge>
                              </span>
                            ))
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>Sin asignaciones</span>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        {user.active ? (
                          <StatusBadge tone="green">Activo</StatusBadge>
                        ) : (
                          <StatusBadge tone="red">Inactivo</StatusBadge>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '2px 8px', fontSize: 10 }}
                            disabled={busy}
                            onClick={() => handleToggleActive(user)}
                          >
                            {user.active ? 'Desactivar' : 'Activar'}
                          </button>
                          {user.assignments
                            .filter((a) => a.active)
                            .map((a) => (
                              <button
                                key={`revoke-${a.organizationId}`}
                                type="button"
                                className="btn"
                                style={{ padding: '2px 8px', fontSize: 10 }}
                                disabled={busy}
                                onClick={() => handleRevoke(user, a.organizationId)}
                              >
                                Retirar {a.organizationCode}
                              </button>
                            ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Note>Sin usuarios registrados todavía.</Note>
          )}

          <div
            style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap', alignItems: 'end' }}
          >
            <div className="field" style={{ minWidth: 180 }}>
              <label>Organización para asignar</label>
              <select
                className="control"
                value={assignOrgId}
                onChange={(event) => setAssignOrgId(event.target.value)}
              >
                {ORGANIZATIONS.map((organization) => (
                  <option key={organization.id} value={organization.id}>
                    {organization.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="field" style={{ minWidth: 160 }}>
              <label>Rol</label>
              <select
                className="control"
                value={assignRole}
                onChange={(event) => setAssignRole(event.target.value)}
              >
                {ROLES.map((role) => (
                  <option key={role.code} value={role.code}>
                    {role.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {users?.items.length ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {users.items
                .filter((user) => user.active)
                .map((user) => (
                  <button
                    key={`assign-${user.id}`}
                    type="button"
                    className="btn"
                    style={{ padding: '2px 10px', fontSize: 10 }}
                    disabled={busy}
                    onClick={() => handleAddAssignment(user)}
                  >
                    Asignar a {user.displayName}
                  </button>
                ))}
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHead
          title="Solicitudes de acceso pendientes"
          subtitle="Usuarios de Keycloak sin cuenta local: se registran al intentar iniciar sesión."
        />
        <CardBody>
          {pending?.items.length ? (
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {pending.items.map((request) => (
                <li key={request.id} style={{ marginBottom: 10 }}>
                  <strong>{request.displayName ?? request.email}</strong>
                  <br />
                  <span style={{ color: 'var(--muted)', fontSize: 11 }}>{request.email}</span>
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '2px 10px', fontSize: 10 }}
                      disabled={busy}
                      onClick={() => handleApprove(request)}
                    >
                      Aprobar con la organización y rol seleccionados
                    </button>
                    <button
                      type="button"
                      className="btn"
                      style={{ padding: '2px 10px', fontSize: 10 }}
                      disabled={busy}
                      onClick={() => handleReject(request)}
                    >
                      Rechazar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <Note>No hay solicitudes pendientes.</Note>
          )}

          <div
            style={{ marginTop: 16, borderTop: '1px solid var(--border, #e2e6ee)', paddingTop: 12 }}
          >
            <h4 style={{ marginTop: 0 }}>Nuevo usuario</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div className="field" style={{ minWidth: 200 }}>
                <label>Correo electrónico</label>
                <input
                  className="control"
                  placeholder="usuario@organizacion.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </div>
              <div className="field" style={{ minWidth: 160 }}>
                <label>Nombre completo</label>
                <input
                  className="control"
                  placeholder="Ana María Restrepo"
                  value={displayName}
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </div>
              <div className="field" style={{ minWidth: 140 }}>
                <label>Contraseña inicial</label>
                <input
                  className="control"
                  type="password"
                  placeholder="Mínimo 8 caracteres"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
              <div className="field" style={{ minWidth: 180 }}>
                <label>Organización</label>
                <select
                  className="control"
                  value={newOrgId}
                  onChange={(event) => setNewOrgId(event.target.value)}
                >
                  {ORGANIZATIONS.map((organization) => (
                    <option key={organization.id} value={organization.id}>
                      {organization.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ minWidth: 160 }}>
                <label>Rol</label>
                <select
                  className="control"
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value)}
                >
                  {ROLES.map((role) => (
                    <option key={role.code} value={role.code}>
                      {role.label}
                    </option>
                  ))}
                </select>
              </div>
              <div style={{ alignSelf: 'end' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={
                    busy ||
                    !email.includes('@') ||
                    displayName.trim().length < 1 ||
                    password.length < 8
                  }
                  onClick={handleCreate}
                >
                  Crear usuario
                </button>
              </div>
            </div>
            <Note>
              El usuario se crea habilitado en Keycloak con la contraseña indicada y queda auditado.
              Comparta la credencial por un canal seguro.
            </Note>
          </div>
        </CardBody>
      </Card>
    </div>
  );
}

export function UsersAdminSection({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  if (!enabled) {
    return null;
  }
  return <UsersAdminCard organizationId={organizationId} />;
}
