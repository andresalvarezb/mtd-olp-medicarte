'use client';

import { useEffect, useMemo, useState } from 'react';
import { useApiData } from '@/hooks/use-api-data';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { Note } from '@/components/ui/timeline';
import { StatusBadge } from '@/components/ui/status-badge';
import {
  createRole,
  deleteRole,
  getRoleAccess,
  listRoles,
  updateRole,
  updateRoleAccess,
  type RoleAccessResponse,
} from '@/lib/roles-api';

type OrganizationCode = 'MTD' | 'MEDICARTE' | 'OLP' | 'COMPENSAR';

const ORGANIZATIONS: ReadonlyArray<{ code: OrganizationCode; label: string }> = [
  { code: 'MTD', label: `MTD — Administración` },
  { code: 'COMPENSAR', label: `Compensar — EPS` },
  { code: 'OLP', label: `OLP — Logística` },
  { code: 'MEDICARTE', label: `Medicarte — Aplicación` },
];

function enabledEditablePermissions(access: RoleAccessResponse): string[] {
  return access.modules
    .flatMap((module) => module.actions)
    .filter((action) => action.enabled && action.editable)
    .map((action) => action.permissionCode)
    .sort();
}

function samePermissions(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length && left.every((permission, index) => permission === right[index])
  );
}

export function RolesAdminCard({ organizationId }: { organizationId: string }) {
  const roles = useApiData(() => listRoles(organizationId), [organizationId]);
  const [selectedRoleCode, setSelectedRoleCode] = useState<string | null>(null);
  const [draftPermissionCodes, setDraftPermissionCodes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [newRoleName, setNewRoleName] = useState('');
  const [newRoleOrganizations, setNewRoleOrganizations] = useState<OrganizationCode[]>(['MTD']);
  const [showFixedActions, setShowFixedActions] = useState(false);

  useEffect(() => {
    if (!selectedRoleCode && roles.data?.items.length) {
      const preferred =
        roles.data.items.find((role) => role.code === 'MTD_OPERATOR' && role.active) ??
        roles.data.items.find((role) => !role.isProtected && role.active) ??
        roles.data.items[0];
      if (preferred) setSelectedRoleCode(preferred.code);
    }
  }, [roles.data, selectedRoleCode]);

  const access = useApiData(
    () =>
      selectedRoleCode ? getRoleAccess(organizationId, selectedRoleCode) : Promise.resolve(null),
    [organizationId, selectedRoleCode],
  );

  useEffect(() => {
    if (access.data) {
      setDraftPermissionCodes(enabledEditablePermissions(access.data));
      setSaveError(null);
      setSaveMessage(null);
    }
  }, [access.data]);

  const baseline = useMemo(
    () => (access.data ? enabledEditablePermissions(access.data) : []),
    [access.data],
  );
  const dirty = !samePermissions([...draftPermissionCodes].sort(), baseline);
  const editableCount =
    access.data?.modules.flatMap((module) => module.actions).filter((action) => action.editable)
      .length ?? 0;
  const enabledEditableCount =
    access.data?.modules
      .flatMap((module) => module.actions)
      .filter((action) => action.editable && action.enabled).length ?? 0;
  const fixedCount =
    access.data?.modules.flatMap((module) => module.actions).filter((action) => !action.editable)
      .length ?? 0;
  const visibleModules = useMemo(
    () =>
      (access.data?.modules ?? [])
        .map((module) => ({
          ...module,
          actions: module.actions.filter((action) => showFixedActions || action.editable),
        }))
        .filter((module) => module.actions.length),
    [access.data, showFixedActions],
  );

  const togglePermission = (permissionCode: string) => {
    setDraftPermissionCodes((current) =>
      current.includes(permissionCode)
        ? current.filter((code) => code !== permissionCode)
        : [...current, permissionCode].sort(),
    );
    setSaveMessage(null);
  };

  const save = () => {
    if (!access.data || !selectedRoleCode || access.data.role.isProtected || !dirty) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    void updateRoleAccess(organizationId, selectedRoleCode, {
      expectedFingerprint: access.data.fingerprint,
      permissionCodes: draftPermissionCodes,
    })
      .then((updated) => {
        setDraftPermissionCodes(enabledEditablePermissions(updated));
        setSaveMessage('Accesos guardados.');
        access.reload();
        roles.reload();
      })
      .catch((error: unknown) => {
        setSaveError(
          error instanceof Error ? error.message : 'No se pudieron guardar los accesos.',
        );
        access.reload();
      })
      .finally(() => setSaving(false));
  };

  const createCustomRole = () => {
    if (!newRoleName.trim() || !newRoleOrganizations.length) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    void createRole(organizationId, {
      name: newRoleName.trim(),
      organizationCodes: newRoleOrganizations,
    })
      .then((created) => {
        setNewRoleName('');
        setNewRoleOrganizations(['MTD']);
        setSelectedRoleCode(created.code);
        setSaveMessage(`Rol "${created.name}" creado.`);
        roles.reload();
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : 'No se pudo crear el rol.');
      })
      .finally(() => setSaving(false));
  };

  const toggleSelectedRole = () => {
    if (!access.data?.role.isCustom || !selectedRoleCode) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    void updateRole(organizationId, selectedRoleCode, {
      active: !access.data.role.active,
    })
      .then((updated) => {
        setSaveMessage(updated.active ? 'Rol reactivado.' : 'Rol desactivado.');
        roles.reload();
        access.reload();
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : 'No se pudo actualizar el rol.');
      })
      .finally(() => setSaving(false));
  };

  const removeSelectedRole = () => {
    if (!access.data?.role.isCustom || access.data.role.active || !selectedRoleCode) return;
    if (!window.confirm(`¿Eliminar definitivamente el rol "${access.data.role.label}"?`)) return;
    setSaving(true);
    setSaveError(null);
    setSaveMessage(null);
    void deleteRole(organizationId, selectedRoleCode)
      .then(() => {
        setSelectedRoleCode(null);
        setSaveMessage('Rol eliminado.');
        roles.reload();
      })
      .catch((error: unknown) => {
        setSaveError(error instanceof Error ? error.message : 'No se pudo eliminar el rol.');
      })
      .finally(() => setSaving(false));
  };

  return (
    <Card>
      <CardHead
        title="Roles y permisos"
        subtitle="Elige un rol y asigna las acciones que puede ejecutar. Las reglas estructurales se muestran aparte y no se pueden modificar."
      />
      <CardBody>
        {roles.error ? (
          <div className="login-error" role="alert">
            {roles.error}
          </div>
        ) : null}
        {saveError ? (
          <div className="login-error" role="alert">
            {saveError}
          </div>
        ) : null}
        {saveMessage ? (
          <div role="status" style={{ color: 'var(--success, #18794e)', marginBottom: 10 }}>
            {saveMessage}
          </div>
        ) : null}
        <Note>
          El administrador del sistema puede configurar los roles predefinidos y personalizados.
          `MTD_ADMIN` es protegido y conserva acceso total; selecciona otro rol para cambiar sus
          acciones.
        </Note>

        <div
          style={{
            border: '1px solid var(--border, #e2e6ee)',
            borderRadius: 8,
            padding: 12,
            marginBottom: 14,
          }}
        >
          <strong>Crear rol personalizado</strong>
          <p style={{ margin: '4px 0 10px', color: 'var(--muted)', fontSize: 12 }}>
            Define un rol reutilizable y su alcance organizacional. Los límites estructurales del
            sistema siguen protegidos.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
            <div className="field" style={{ minWidth: 240 }}>
              <label htmlFor="new-role-name">Nombre del rol</label>
              <input
                id="new-role-name"
                className="control"
                placeholder="Ej. Coordinación regional"
                value={newRoleName}
                onChange={(event) => setNewRoleName(event.target.value)}
              />
            </div>
            <div className="field" style={{ minWidth: 300 }}>
              <span style={{ display: 'block', marginBottom: 4 }}>Organizaciones</span>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {ORGANIZATIONS.map((organization) => (
                  <label key={organization.code} style={{ fontSize: 12 }}>
                    <input
                      type="checkbox"
                      checked={newRoleOrganizations.includes(organization.code)}
                      onChange={() =>
                        setNewRoleOrganizations((current) =>
                          current.includes(organization.code)
                            ? current.filter((code) => code !== organization.code)
                            : [...current, organization.code],
                        )
                      }
                    />{' '}
                    {organization.label}
                  </label>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="btn"
              disabled={saving || !newRoleName.trim() || !newRoleOrganizations.length}
              onClick={createCustomRole}
            >
              Crear rol
            </button>
          </div>
        </div>

        {roles.data?.items.length ? (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(190px, 0.32fr) minmax(0, 1fr)',
              gap: 16,
              alignItems: 'start',
            }}
          >
            <div style={{ display: 'grid', gap: 6 }}>
              {roles.data.items.map((role) => (
                <button
                  key={role.code}
                  type="button"
                  className="btn"
                  aria-pressed={selectedRoleCode === role.code}
                  onClick={() => setSelectedRoleCode(role.code)}
                  style={{
                    textAlign: 'left',
                    padding: '8px 10px',
                    borderColor:
                      selectedRoleCode === role.code ? 'var(--accent, #2563eb)' : undefined,
                  }}
                >
                  <strong>{role.label}</strong>{' '}
                  {role.isCustom ? <StatusBadge tone="purple">Personalizado</StatusBadge> : null}
                  {!role.active ? <StatusBadge tone="red">Inactivo</StatusBadge> : null}
                  <br />
                  <small style={{ color: 'var(--muted)' }}>
                    {role.userCount} usuarios · {role.permissionCount} permisos ·{' '}
                    {role.allowedOrganizationCodes.join(', ')}
                  </small>
                </button>
              ))}
            </div>

            <div>
              {access.loading ? <Note>Cargando permisos del rol…</Note> : null}
              {access.error ? (
                <div className="login-error" role="alert">
                  {access.error}
                </div>
              ) : null}
              {access.data ? (
                <>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 8,
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      marginBottom: 10,
                    }}
                  >
                    <div>
                      <strong>{access.data.role.label}</strong>{' '}
                      <span style={{ color: 'var(--muted)' }}>({access.data.role.code})</span>
                      <br />
                      <small style={{ color: 'var(--muted)' }}>
                        {enabledEditableCount} de {editableCount} acciones asignables · {fixedCount}{' '}
                        no asignables por política
                      </small>
                    </div>
                    {access.data.role.isProtected ? (
                      <StatusBadge tone="orange">Protegido</StatusBadge>
                    ) : !access.data.role.active ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={saving}
                          onClick={toggleSelectedRole}
                        >
                          Reactivar rol
                        </button>
                        <button
                          type="button"
                          className="btn"
                          disabled={saving}
                          onClick={removeSelectedRole}
                        >
                          Eliminar rol
                        </button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="btn"
                          disabled={saving || !dirty}
                          onClick={save}
                        >
                          {saving ? 'Guardando…' : 'Guardar accesos'}
                        </button>
                        {access.data.role.isCustom ? (
                          <>
                            <button
                              type="button"
                              className="btn"
                              disabled={saving}
                              onClick={toggleSelectedRole}
                            >
                              Desactivar rol
                            </button>
                            <button
                              type="button"
                              className="btn"
                              disabled={saving}
                              title="Desactiva el rol antes de eliminarlo"
                              onClick={() => {
                                setSaveError('Desactiva el rol antes de eliminarlo.');
                              }}
                            >
                              Eliminar rol
                            </button>
                          </>
                        ) : null}
                      </div>
                    )}
                  </div>
                  {access.data.role.isProtected ? (
                    <Note>
                      Este rol es estructural y no se puede editar. El administrador conserva el
                      acceso total definido por la política del sistema.
                    </Note>
                  ) : null}
                  {!access.data.role.active ? (
                    <Note>Este rol está inactivo y no puede asignarse a nuevos usuarios.</Note>
                  ) : null}
                  <label
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      marginTop: 10,
                      color: 'var(--muted)',
                      fontSize: 12,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={showFixedActions}
                      onChange={(event) => setShowFixedActions(event.target.checked)}
                    />
                    Mostrar también acciones no asignables (solo lectura)
                  </label>

                  {visibleModules.length ? (
                    <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                      {visibleModules.map((module) => (
                        <section
                          key={module.code}
                          style={{
                            border: '1px solid var(--border, #e2e6ee)',
                            borderRadius: 8,
                            padding: 10,
                          }}
                        >
                          <div style={{ marginBottom: 6 }}>
                            <strong>{module.label}</strong>
                            <br />
                            <small style={{ color: 'var(--muted)' }}>{module.description}</small>
                          </div>
                          <div style={{ display: 'grid', gap: 4 }}>
                            {module.actions.map((action) => (
                              <label
                                key={action.permissionCode}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: 8,
                                  color: action.editable ? undefined : 'var(--muted)',
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={
                                    action.editable
                                      ? draftPermissionCodes.includes(action.permissionCode)
                                      : action.enabled
                                  }
                                  disabled={
                                    !action.editable ||
                                    saving ||
                                    (access.data?.role.isProtected ?? false)
                                  }
                                  onChange={() => togglePermission(action.permissionCode)}
                                />
                                <span>{action.label}</span>
                                {!action.editable ? (
                                  <StatusBadge tone="gray">
                                    {action.structural
                                      ? 'Estructural'
                                      : action.lifecycle === 'ACTIVE'
                                        ? 'Fuera del alcance'
                                        : 'No activa'}
                                  </StatusBadge>
                                ) : null}
                              </label>
                            ))}
                          </div>
                        </section>
                      ))}
                    </div>
                  ) : (
                    <Note>
                      Este rol no tiene acciones asignables. Activa “Mostrar también acciones no
                      asignables” para consultar las capacidades aplicadas por política.
                    </Note>
                  )}
                </>
              ) : null}
            </div>
          </div>
        ) : !roles.loading ? (
          <Note>No hay roles disponibles.</Note>
        ) : (
          <Note>Cargando roles…</Note>
        )}
      </CardBody>
    </Card>
  );
}

export function RolesAdminSection({
  organizationId,
  enabled,
}: {
  organizationId: string;
  enabled: boolean;
}) {
  if (!enabled) return null;
  return <RolesAdminCard organizationId={organizationId} />;
}
