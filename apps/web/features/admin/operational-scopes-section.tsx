'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, CardHead } from '@/components/ui/card';
import { Note } from '@/components/ui/timeline';
import { useApiData } from '@/hooks/use-api-data';
import { listUsers } from '@/lib/users-api';
import {
  getUserPointScope,
  listAssignablePoints,
  replaceUserPointScope,
} from '@/lib/access-scopes-api';
import type { UserResponse } from '@/lib/users-api';

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

  const medicarteUsers = useMemo(
    () =>
      (users.data?.items ?? []).filter((user) =>
        user.assignments.some(
          (assignment) =>
            assignment.organizationCode === 'MEDICARTE' &&
            assignment.roleCode === 'MEDICARTE_OPERATOR' &&
            assignment.active,
        ),
      ),
    [users.data],
  );
  const filtered = medicarteUsers.filter((user) => {
    const haystack = `${user.username} ${user.displayName}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase());
  });

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
  const selected = medicarteUsers.find((user) => user.id === selectedId) ?? null;
  const displayed = selectedIds;

  return (
    <Card>
      <CardHead
        title="Accesos operacionales"
        subtitle="Asignación de puntos de dispensación a operadores Medicarte. Independiente del rol RBAC."
      />
      <CardBody>
        {error ? <Note>{error}</Note> : null}
        {saved ? <Note>Alcance actualizado.</Note> : null}
        <label>
          Buscar usuario Medicarte
          <input value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <ul>
          {filtered.map((user) => {
            const assignment = user.assignments.find(
              (item) => item.organizationCode === 'MEDICARTE',
            );
            return (
              <li key={user.id}>
                <button className="button" type="button" onClick={() => selectUser(user)}>
                  {user.displayName} · {user.username}
                </button>
                <span>
                  {assignment?.organizationCode} · {assignment?.roleCode}
                </span>
              </li>
            );
          })}
        </ul>
        {selected ? (
          <>
            <p>
              {selected.displayName} · {selected.username} · MEDICARTE · MEDICARTE_OPERATOR
            </p>
            {(points.data?.items ?? []).map((point) => (
              <label key={point.id}>
                <input
                  type="checkbox"
                  checked={displayed.includes(point.id)}
                  disabled={!canManage}
                  onChange={() => toggle(point.id)}
                />
                {point.code} · {point.name}
              </label>
            ))}
            {canManage ? (
              <button className="button" type="button" onClick={() => void save()}>
                Guardar
              </button>
            ) : null}
          </>
        ) : (
          <p>Selecciona un operador Medicarte para ver y editar sus puntos.</p>
        )}
      </CardBody>
    </Card>
  );
}
