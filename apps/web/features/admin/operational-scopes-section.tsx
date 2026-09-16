'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/status-badge';
import { Note } from '@/components/ui/timeline';
import { useApiData } from '@/hooks/use-api-data';
import { listUsers } from '@/lib/users-api';
import {
  getUserPointScope,
  listAssignablePoints,
  replaceUserPointScope,
} from '@/lib/access-scopes-api';
import type { UserResponse } from '@/lib/users-api';

function isPointScopeEligible(user: UserResponse): boolean {
  return user.assignments.some(
    (assignment) =>
      assignment.active &&
      assignment.organizationCode === 'MEDICARTE' &&
      (assignment.roleCode === 'MEDICARTE_OPERATOR' || assignment.roleCode.startsWith('CUSTOM_')),
  );
}

export function OperationalScopesSection({
  organizationId,
  canRead,
  canManage,
}: {
  organizationId: string;
  canRead: boolean;
  canManage: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const users = useApiData(() => listUsers(organizationId), [organizationId]);
  const points = useApiData(() => listAssignablePoints(organizationId), [organizationId]);
  const scope = useApiData(
    () => (selectedId ? getUserPointScope(organizationId, selectedId) : Promise.resolve(null)),
    [organizationId, selectedId],
  );

  const eligibleUsers = useMemo(
    () => (users.data?.items ?? []).filter((user) => user.active && isPointScopeEligible(user)),
    [users.data],
  );
  const filteredUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return eligibleUsers.filter((user) =>
      `${user.username} ${user.displayName}`.toLowerCase().includes(normalizedQuery),
    );
  }, [eligibleUsers, query]);
  const selected = eligibleUsers.find((user) => user.id === selectedId) ?? null;

  useEffect(() => {
    if (scope.data && selectedId === scope.data.userId) {
      setSelectedIds(scope.data.grants.map((grant) => grant.dispensingPointId));
    }
  }, [scope.data, selectedId]);

  function selectUser(user: UserResponse) {
    setSelectedId(user.id);
    setSelectedIds([]);
    setSaved(false);
    setError(null);
  }

  function toggle(pointId: string) {
    setSelectedIds((current) =>
      current.includes(pointId) ? current.filter((id) => id !== pointId) : [...current, pointId],
    );
    setSaved(false);
  }

  async function save() {
    if (!selectedId || !canManage) return;
    setError(null);
    setSaved(false);
    try {
      const next = await replaceUserPointScope(organizationId, selectedId, {
        pointIds: selectedIds,
      });
      setSelectedIds(next.grants.map((grant) => grant.dispensingPointId));
      setSaved(true);
      scope.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No fue posible guardar el alcance');
    }
  }

  if (!canRead) return null;

  return (
    <Card>
      <CardHead
        title="Puntos operativos Medicarte"
        subtitle="Define en qué puntos de dispensación puede operar cada usuario. Esta autorización complementa el rol y no cambia sus permisos funcionales."
      />
      <CardBody>
        <Note>
          Solo aparecen cuentas activas con un rol Medicarte operador o un rol personalizado
          compatible. Sin puntos asignados, el acceso operacional queda bloqueado por seguridad.
        </Note>
        {error ? (
          <div className="login-error" role="alert" style={{ marginBottom: 10 }}>
            {error}
          </div>
        ) : null}
        {saved ? <Note>Alcance actualizado correctamente.</Note> : null}
        {users.error ? <Note>No se pudieron cargar los usuarios: {users.error}</Note> : null}
        {points.error ? <Note>No se pudieron cargar los puntos: {points.error}</Note> : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(220px, 0.8fr) minmax(320px, 1.2fr)',
            gap: 16,
            marginTop: 12,
          }}
        >
          <div>
            <label className="field" style={{ display: 'block' }}>
              <span>Buscar operador</span>
              <input
                className="control"
                placeholder="Nombre o usuario"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div style={{ display: 'grid', gap: 6, marginTop: 10 }}>
              {filteredUsers.map((user) => {
                const assignment = user.assignments.find(
                  (item) =>
                    item.active &&
                    item.organizationCode === 'MEDICARTE' &&
                    (item.roleCode === 'MEDICARTE_OPERATOR' || item.roleCode.startsWith('CUSTOM_')),
                );
                const active = user.id === selectedId;
                return (
                  <button
                    key={user.id}
                    type="button"
                    className="btn"
                    style={{
                      textAlign: 'left',
                      borderColor: active ? 'var(--accent, #2563eb)' : undefined,
                    }}
                    onClick={() => selectUser(user)}
                  >
                    <strong>{user.displayName}</strong>
                    <br />
                    <small>
                      {user.username} · {assignment?.roleCode}
                    </small>
                  </button>
                );
              })}
              {!filteredUsers.length ? <Note>No hay operadores que coincidan.</Note> : null}
            </div>
          </div>
          <div>
            {selected ? (
              <>
                <div style={{ marginBottom: 10 }}>
                  <strong>{selected.displayName}</strong>
                  <br />
                  <span style={{ color: 'var(--muted)' }}>{selected.username} · MEDICARTE</span>
                  <div style={{ marginTop: 6 }}>
                    <StatusBadge tone="blue">
                      Puntos seleccionados: {selectedIds.length}
                    </StatusBadge>
                    {!canManage ? <StatusBadge tone="gray">Solo lectura</StatusBadge> : null}
                  </div>
                </div>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                    gap: 8,
                  }}
                >
                  {(points.data?.items ?? []).map((point) => (
                    <label
                      key={point.id}
                      style={{
                        display: 'flex',
                        gap: 8,
                        alignItems: 'flex-start',
                        padding: 8,
                        border: '1px solid var(--border, #e2e6ee)',
                        borderRadius: 6,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(point.id)}
                        disabled={!canManage}
                        onChange={() => toggle(point.id)}
                      />
                      <span>
                        <strong>{point.code}</strong>
                        <br />
                        <small>{point.name}</small>
                      </span>
                    </label>
                  ))}
                </div>
                {canManage ? (
                  <button
                    className="btn"
                    type="button"
                    style={{ marginTop: 12 }}
                    disabled={scope.loading}
                    onClick={() => void save()}
                  >
                    Guardar puntos operativos
                  </button>
                ) : null}
              </>
            ) : (
              <Note>Selecciona un operador para consultar y editar sus puntos.</Note>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
