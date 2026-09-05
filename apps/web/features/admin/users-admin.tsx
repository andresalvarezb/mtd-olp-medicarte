'use client';

import { useState } from 'react';
import { Card, CardHead, CardBody } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { useApiData } from '@/hooks/use-api-data';
import {
  addAssignment,
  createUser,
  listUsers,
  resetUserPassword,
  revokeAssignment,
  updateUser,
} from '@/lib/users-api';
import { ORGANIZATION_IDS } from '@/lib/config';
import type { UserResponse } from '@/lib/users-api';

const ORGANIZATIONS: Array<{ id: string; code: string; label: string }> = [
  { id: ORGANIZATION_IDS.MTD, code: 'MTD', label: 'MTD — Administración' },
  { id: ORGANIZATION_IDS.COMPENSAR, code: 'COMPENSAR', label: 'Compensar — EPS' },
  { id: ORGANIZATION_IDS.OLP, code: 'OLP', label: 'OLP — Logística' },
  { id: ORGANIZATION_IDS.MEDICARTE, code: 'MEDICARTE', label: 'Medicarte — Aplicación' },
];

const ROLES: Array<{ code: string; label: string }> = [
  { code: 'MTD_ADMIN', label: 'MTD Admin' },
  { code: 'MTD_OPERATOR', label: 'MTD Operación' },
  { code: 'MTD_GENERAL', label: 'MTD General' },
  { code: 'MTD_AUDITORIA', label: 'MTD Auditoría' },
  { code: 'COMPENSAR_VIEWER', label: 'Compensar Consulta' },
  { code: 'OLP_OPERATOR', label: 'OLP Operador' },
  { code: 'MEDICARTE_OPERATOR', label: 'Medicarte Operador' },
  { code: 'READ_ONLY', label: 'Solo lectura' },
];

function roleLabel(code: string): string {
  return ROLES.find((role) => role.code === code)?.label ?? code;
}

function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function UsersAdminCard({ organizationId }: { organizationId: string }) {
  const users = useApiData(() => listUsers(organizationId), [organizationId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Alta de usuario (ADR-026: cuentas exclusivamente administrativas)
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [newOrgId, setNewOrgId] = useState(ORGANIZATION_IDS.MTD);
  const [newRole, setNewRole] = useState('MTD_OPERATOR');

  // Asignación
  const [assignOrgId, setAssignOrgId] = useState(ORGANIZATION_IDS.MTD);
  const [assignRole, setAssignRole] = useState('MTD_OPERATOR');

  // Reset de contraseña: userId -> nueva contraseña generada (visible una vez).
  const [resetFor, setResetFor] = useState<UserResponse | null>(null);
  const [resetPassword, setResetPassword] = useState('');

  const reloadUsers = () => users.reload();

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
        username: username.trim().toLowerCase(),
        displayName: displayName.trim(),
        password,
        organizationId: newOrgId,
        roleCode: newRole,
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      reloadUsers();
    });

  const handleToggleActive = (user: UserResponse) =>
    run(async () => {
      await updateUser(organizationId, user.id, { active: !user.active });
      reloadUsers();
    });

  const handleAddAssignment = (user: UserResponse) =>
    run(async () => {
      await addAssignment(organizationId, user.id, {
        organizationId: assignOrgId,
        roleCode: assignRole,
      });
      reloadUsers();
    });

  const handleRevoke = (user: UserResponse, targetOrganizationId: string) =>
    run(async () => {
      await revokeAssignment(organizationId, user.id, targetOrganizationId);
      reloadUsers();
    });

  const handlePrepareReset = (user: UserResponse) => {
    const generated = generatePassword();
    setResetFor(user);
    setResetPassword(generated);
  };

  const handleConfirmReset = () =>
    run(async () => {
      if (!resetFor) return;
      await resetUserPassword(organizationId, resetFor.id, {
        password: resetPassword,
        mustChangePassword: true,
      });
      setResetFor(null);
      setResetPassword('');
      reloadUsers();
    });

  return (
    <div className="config-grid" style={{ marginTop: 16 }}>
      <Card>
        <CardHead
          title="Usuarios con acceso"
          subtitle="Cuentas locales de la plataforma: alta, activación y asignaciones por organización."
        />
        <CardBody>
          {error ? (
            <div className="login-error" role="alert" style={{ marginBottom: 10 }}>
              {error}
            </div>
          ) : null}
          {users.data?.items.length ? (
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
                  {users.data.items.map((user) => (
                    <tr key={user.id} style={{ borderTop: '1px solid var(--border, #e2e6ee)' }}>
                      <td style={{ padding: '8px' }}>
                        <strong>{user.displayName}</strong>
                        <br />
                        <span style={{ color: 'var(--muted)' }}>{user.username}</span>
                        {!user.passwordConfigured ? (
                          <StatusBadge tone="orange">Sin contraseña</StatusBadge>
                        ) : null}
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
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '2px 8px', fontSize: 10 }}
                            disabled={busy}
                            onClick={() => handlePrepareReset(user)}
                          >
                            Restablecer contraseña
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
          {users.data?.items.length ? (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
              {users.data.items
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
          title="Cuentas y credenciales"
          subtitle="La creación de usuarios es exclusivamente administrativa; no hay registro público."
        />
        <CardBody>
          {resetFor ? (
            <div
              style={{
                marginBottom: 14,
                padding: 10,
                border: '1px solid var(--border, #e2e6ee)',
                borderRadius: 8,
              }}
            >
              <strong>Restablecer contraseña de {resetFor.username}</strong>
              <div className="field" style={{ marginTop: 8 }}>
                <label>Nueva contraseña (edítala si lo necesitas)</label>
                <input
                  className="control"
                  value={resetPassword}
                  onChange={(event) => setResetPassword(event.target.value)}
                />
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || resetPassword.length < 12}
                  onClick={handleConfirmReset}
                >
                  Confirmar restablecimiento
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    setResetFor(null);
                    setResetPassword('');
                  }}
                >
                  Cancelar
                </button>
              </div>
              <div style={{ marginTop: 8 }}>
                <Note>
                  La contraseña se muestra una sola vez: compártela por un canal seguro. El usuario
                  deberá cambiarla al ingresar.
                </Note>
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: 0 }}>
            <h4 style={{ marginTop: 0 }}>Nuevo usuario</h4>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <div className="field" style={{ minWidth: 160 }}>
                <label>Usuario</label>
                <input
                  className="control"
                  placeholder="nombre.apellido"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
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
              <div className="field" style={{ minWidth: 180 }}>
                <label>Contraseña inicial (mínimo 12 caracteres)</label>
                <input
                  className="control"
                  type="password"
                  placeholder="••••••••••••"
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
                    !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,159}$/.test(username.trim()) ||
                    displayName.trim().length < 1 ||
                    password.length < 12
                  }
                  onClick={handleCreate}
                >
                  Crear usuario
                </button>
              </div>
            </div>
            <Note>
              La contraseña se guarda únicamente como hash Argon2id y queda auditada la creación.
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
