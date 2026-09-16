'use client';

import { useEffect, useMemo, useState } from 'react';
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
import type { UserResponse } from '@/lib/users-api';
import { listRoles, type RoleSummary } from '@/lib/roles-api';
import { ORGANIZATION_IDS_BY_CODE, ORGANIZATION_LABELS } from '@/lib/config';

function roleLabel(code: string, roles: readonly RoleSummary[]): string {
  return roles.find((role) => role.code === code)?.label ?? code;
}

function organizationIdForCode(code: string): string | undefined {
  return ORGANIZATION_IDS_BY_CODE[code as keyof typeof ORGANIZATION_IDS_BY_CODE];
}

function organizationLabel(code: string): string {
  return ORGANIZATION_LABELS[code as keyof typeof ORGANIZATION_LABELS] ?? code;
}

function generatePassword(): string {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

export function UsersAdminCard({ organizationId }: { organizationId: string }) {
  const users = useApiData(() => listUsers(organizationId), [organizationId]);
  const roles = useApiData(() => listRoles(organizationId), [organizationId]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [userQuery, setUserQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('active');

  // Alta de usuario (ADR-026: cuentas exclusivamente administrativas)
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [newRole, setNewRole] = useState('MTD_OPERATOR');
  const [newOrganizationCodes, setNewOrganizationCodes] = useState<string[]>([]);

  // Reset de contraseña: userId -> nueva contraseña generada (visible una vez).
  const [resetFor, setResetFor] = useState<UserResponse | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [assignmentFor, setAssignmentFor] = useState<UserResponse | null>(null);
  const [assignmentRole, setAssignmentRole] = useState('');
  const [assignmentOrganizationCode, setAssignmentOrganizationCode] = useState('');

  const assignableNewRoles = useMemo(
    () => (roles.data?.items ?? []).filter((role) => role.active),
    [roles.data],
  );
  const selectedNewRole = assignableNewRoles.find((role) => role.code === newRole);
  const assignmentRoles = assignableNewRoles;
  const selectedAssignmentRole = assignmentRoles.find((role) => role.code === assignmentRole);
  const assignmentOrganizationCodes = selectedAssignmentRole?.allowedOrganizationCodes ?? [];
  const visibleUsers = useMemo(() => {
    const normalizedQuery = userQuery.trim().toLowerCase();
    return (users.data?.items ?? []).filter((user) => {
      const matchesStatus =
        statusFilter === 'all' || (statusFilter === 'active' ? user.active : !user.active);
      const matchesQuery =
        !normalizedQuery ||
        [user.username, user.displayName, user.email ?? ''].some((value) =>
          value.toLowerCase().includes(normalizedQuery),
        );
      return matchesStatus && matchesQuery;
    });
  }, [statusFilter, userQuery, users.data]);
  const userStats = useMemo(() => {
    const allUsers = users.data?.items ?? [];
    return {
      total: allUsers.length,
      active: allUsers.filter((user) => user.active).length,
      inactive: allUsers.filter((user) => !user.active).length,
      administrators: allUsers.filter(
        (user) =>
          user.active && user.assignments.some((assignment) => assignment.roleCode === 'MTD_ADMIN'),
      ).length,
    };
  }, [users.data]);

  useEffect(() => {
    if (assignableNewRoles.length && !assignableNewRoles.some((role) => role.code === newRole)) {
      const firstRole = assignableNewRoles[0];
      if (firstRole) setNewRole(firstRole.code);
    }
  }, [assignableNewRoles, newRole]);

  useEffect(() => {
    const allowed = selectedNewRole?.allowedOrganizationCodes ?? [];
    setNewOrganizationCodes((current) => {
      const compatible = current.filter((code) => allowed.includes(code));
      if (compatible.length) return compatible;
      return allowed[0] ? [allowed[0]] : [];
    });
  }, [selectedNewRole]);

  useEffect(() => {
    if (!assignmentFor || !assignmentRoles.length) return;
    if (!assignmentRoles.some((role) => role.code === assignmentRole)) {
      setAssignmentRole(assignmentRoles[0]?.code ?? '');
    }
  }, [assignmentFor, assignmentRole, assignmentRoles]);

  useEffect(() => {
    if (!assignmentFor) return;
    if (!assignmentOrganizationCodes.includes(assignmentOrganizationCode)) {
      setAssignmentOrganizationCode(assignmentOrganizationCodes[0] ?? '');
    }
  }, [assignmentFor, assignmentOrganizationCode, assignmentOrganizationCodes]);

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
        organizationIds: newOrganizationCodes
          .map(organizationIdForCode)
          .filter((id): id is string => id !== undefined),
        roleCode: newRole,
      });
      setUsername('');
      setDisplayName('');
      setPassword('');
      reloadUsers();
    });

  const handlePrepareAssignment = (user: UserResponse) => {
    const firstRole = assignmentRoles[0];
    const firstOrganizationCode = firstRole?.allowedOrganizationCodes[0] ?? '';
    setAssignmentFor(user);
    setAssignmentRole(firstRole?.code ?? '');
    setAssignmentOrganizationCode(firstOrganizationCode);
    setError(null);
  };

  const handleAddAssignment = () =>
    run(async () => {
      if (!assignmentFor || !assignmentRole || !assignmentOrganizationCode) return;
      const targetOrganizationId = organizationIdForCode(assignmentOrganizationCode);
      if (!targetOrganizationId) {
        throw new Error('La organización seleccionada no es válida.');
      }
      await addAssignment(organizationId, assignmentFor.id, {
        organizationId: targetOrganizationId,
        roleCode: assignmentRole,
      });
      setAssignmentFor(null);
      setAssignmentRole('');
      setAssignmentOrganizationCode('');
      reloadUsers();
    });

  const handleToggleActive = (user: UserResponse) =>
    run(async () => {
      await updateUser(organizationId, user.id, { active: !user.active });
      reloadUsers();
    });

  const handleRevoke = (user: UserResponse, targetOrganizationId: string, targetRoleCode: string) =>
    run(async () => {
      await revokeAssignment(organizationId, user.id, targetOrganizationId, targetRoleCode);
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 16 }}>
      <Card>
        <CardHead
          title="Usuarios con acceso"
          subtitle="Consulta, agrega o retira asignaciones concretas de organización y rol."
        />
        <CardBody>
          {error ? (
            <div className="login-error" role="alert" style={{ marginBottom: 10 }}>
              {error}
            </div>
          ) : null}
          {roles.error ? (
            <div className="login-error" role="alert" style={{ marginBottom: 10 }}>
              No se pudieron cargar los roles compatibles: {roles.error}
            </div>
          ) : null}
          <Note>
            El rol define las organizaciones permitidas. Las asignaciones visibles son los accesos
            efectivos de cada cuenta y pueden gestionarse sin cambiar sus credenciales.
          </Note>
          {users.data ? (
            <>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                  gap: 8,
                  marginBottom: 12,
                }}
              >
                <StatusBadge tone="blue">Total: {userStats.total}</StatusBadge>
                <StatusBadge tone="green">Activos: {userStats.active}</StatusBadge>
                <StatusBadge tone="gray">Inactivos: {userStats.inactive}</StatusBadge>
                <StatusBadge tone={userStats.administrators > 1 ? 'orange' : 'purple'}>
                  Administradores: {userStats.administrators}
                </StatusBadge>
              </div>
              {userStats.administrators > 1 ? (
                <Note>
                  Hay más de un administrador activo. Revisa las cuentas antes de desactivar o
                  eliminar usuarios.
                </Note>
              ) : null}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  flexWrap: 'wrap',
                  alignItems: 'end',
                  marginBottom: 10,
                }}
              >
                <div className="field" style={{ minWidth: 240, flex: 1 }}>
                  <label htmlFor="users-search">Buscar usuario</label>
                  <input
                    id="users-search"
                    className="control"
                    placeholder="Nombre, usuario o correo"
                    value={userQuery}
                    onChange={(event) => setUserQuery(event.target.value)}
                  />
                </div>
                <div className="field" style={{ minWidth: 150 }}>
                  <label htmlFor="users-status-filter">Estado</label>
                  <select
                    id="users-status-filter"
                    className="control"
                    value={statusFilter}
                    onChange={(event) =>
                      setStatusFilter(event.target.value as 'all' | 'active' | 'inactive')
                    }
                  >
                    <option value="active">Activos</option>
                    <option value="inactive">Inactivos</option>
                    <option value="all">Todos</option>
                  </select>
                </div>
                <small style={{ color: 'var(--muted)', paddingBottom: 8 }}>
                  Mostrando {visibleUsers.length} de {userStats.total}
                </small>
              </div>
            </>
          ) : null}
          {visibleUsers.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                    <th style={{ padding: '6px 8px' }}>Usuario</th>
                    <th style={{ padding: '6px 8px' }}>Accesos</th>
                    <th style={{ padding: '6px 8px' }}>Gestión de acceso</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUsers.map((user) => (
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
                                  {a.organizationCode} ·{' '}
                                  {roleLabel(a.roleCode, roles.data?.items ?? [])}
                                </StatusBadge>
                              </span>
                            ))
                        ) : (
                          <span style={{ color: 'var(--muted)' }}>Sin asignaciones</span>
                        )}
                      </td>
                      <td style={{ padding: '8px' }}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button
                            type="button"
                            className="btn"
                            style={{ padding: '2px 8px', fontSize: 10 }}
                            disabled={busy || !assignmentRoles.length}
                            onClick={() => handlePrepareAssignment(user)}
                          >
                            Agregar acceso
                          </button>
                          {user.assignments
                            .filter((a) => a.active)
                            .map((a) => (
                              <button
                                key={`revoke-${a.organizationId}-${a.roleCode}`}
                                type="button"
                                className="btn"
                                style={{ padding: '2px 8px', fontSize: 10 }}
                                disabled={busy}
                                onClick={() => handleRevoke(user, a.organizationId, a.roleCode)}
                              >
                                Retirar {a.organizationCode} ·{' '}
                                {roleLabel(a.roleCode, roles.data?.items ?? [])}
                              </button>
                            ))}
                          {!user.assignments.some((assignment) => assignment.active) ? (
                            <span style={{ color: 'var(--muted)' }}>Sin accesos para retirar</span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : users.data?.items.length ? (
            <Note>No hay usuarios que coincidan con los filtros actuales.</Note>
          ) : (
            <Note>Sin usuarios registrados todavía.</Note>
          )}
          {assignmentFor ? (
            <div
              style={{
                marginTop: 14,
                padding: 12,
                border: '1px solid var(--border, #e2e6ee)',
                borderRadius: 8,
              }}
            >
              <strong>
                Agregar acceso a {assignmentFor.displayName} ({assignmentFor.username})
              </strong>
              <Note>
                Elige un rol activo y una organización incluida en el alcance de ese rol. Esto
                agrega una asignación sin modificar las existentes.
              </Note>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
                <div className="field" style={{ minWidth: 240 }}>
                  <label htmlFor="assignment-role">Rol</label>
                  <select
                    id="assignment-role"
                    className="control"
                    value={assignmentRole}
                    onChange={(event) => setAssignmentRole(event.target.value)}
                  >
                    {assignmentRoles.map((role) => (
                      <option key={role.code} value={role.code}>
                        {role.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field" style={{ minWidth: 180 }}>
                  <label htmlFor="assignment-organization">Organización</label>
                  <select
                    id="assignment-organization"
                    className="control"
                    value={assignmentOrganizationCode}
                    onChange={(event) => setAssignmentOrganizationCode(event.target.value)}
                  >
                    {assignmentOrganizationCodes.map((code) => (
                      <option key={code} value={code}>
                        {organizationLabel(code)}
                      </option>
                    ))}
                  </select>
                </div>
                <button
                  type="button"
                  className="btn"
                  disabled={busy || !assignmentRole || !assignmentOrganizationCode}
                  onClick={handleAddAssignment}
                >
                  Confirmar acceso
                </button>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => setAssignmentFor(null)}
                >
                  Cancelar
                </button>
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      <Card>
        <CardHead
          title="Cuentas y credenciales"
          subtitle="Administra la identidad para iniciar sesión: crear cuentas, activarlas y restablecer contraseñas."
        />
        <CardBody>
          <Note>
            Una cuenta identifica a la persona y controla si puede iniciar sesión. Sus permisos
            funcionales se asignan arriba mediante organizaciones y roles.
          </Note>
          {users.data?.items.length ? (
            <div style={{ overflowX: 'auto', marginBottom: 14 }}>
              <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                    <th style={{ padding: '6px 8px' }}>Cuenta</th>
                    <th style={{ padding: '6px 8px' }}>Inicio de sesión</th>
                    <th style={{ padding: '6px 8px' }}>Estado</th>
                    <th style={{ padding: '6px 8px' }}>Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {users.data.items.map((user) => (
                    <tr
                      key={`account-${user.id}`}
                      style={{ borderTop: '1px solid var(--border, #e2e6ee)' }}
                    >
                      <td style={{ padding: '8px' }}>
                        <strong>{user.displayName}</strong>
                        <br />
                        <span style={{ color: 'var(--muted)' }}>{user.username}</span>
                      </td>
                      <td style={{ padding: '8px' }}>
                        {user.passwordConfigured ? (
                          <StatusBadge tone="green">Contraseña configurada</StatusBadge>
                        ) : (
                          <StatusBadge tone="orange">Sin contraseña</StatusBadge>
                        )}
                        {user.mustChangePassword ? (
                          <StatusBadge tone="gray">Debe cambiarla</StatusBadge>
                        ) : null}
                      </td>
                      <td style={{ padding: '8px' }}>
                        {user.active ? (
                          <StatusBadge tone="green">Activa</StatusBadge>
                        ) : (
                          <StatusBadge tone="red">Inactiva</StatusBadge>
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
                            {user.active ? 'Desactivar cuenta' : 'Activar cuenta'}
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
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
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
              <div className="field" style={{ minWidth: 280 }}>
                <label>Rol</label>
                <select
                  className="control"
                  value={newRole}
                  onChange={(event) => setNewRole(event.target.value)}
                >
                  {assignableNewRoles.map((role) => (
                    <option key={role.code} value={role.code}>
                      {role.label} · {role.allowedOrganizationCodes.join(', ')}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field" style={{ minWidth: 240 }}>
                <label>Organizaciones con acceso</label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', paddingTop: 6 }}>
                  {(selectedNewRole?.allowedOrganizationCodes ?? []).map((code) => (
                    <label key={code} style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={newOrganizationCodes.includes(code)}
                        onChange={() =>
                          setNewOrganizationCodes((current) =>
                            current.includes(code)
                              ? current.filter((selected) => selected !== code)
                              : [...current, code],
                          )
                        }
                      />
                      {organizationLabel(code)}
                    </label>
                  ))}
                </div>
              </div>
              <div style={{ alignSelf: 'end' }}>
                <button
                  type="button"
                  className="btn"
                  disabled={
                    busy ||
                    !/^[a-zA-Z0-9][a-zA-Z0-9._@-]{2,159}$/.test(username.trim()) ||
                    displayName.trim().length < 1 ||
                    password.length < 12 ||
                    !assignableNewRoles.some((role) => role.code === newRole) ||
                    newOrganizationCodes.length === 0
                  }
                  onClick={handleCreate}
                >
                  Crear usuario
                </button>
              </div>
            </div>
            <Note>
              El rol define las organizaciones permitidas; selecciona una o varias para otorgar el
              acceso inicial. La contraseña se guarda únicamente como hash Argon2id y queda auditada
              la creación. Comparta la credencial por un canal seguro.
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
