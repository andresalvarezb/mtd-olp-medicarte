'use client';

import { useState } from 'react';
import type {
  PatientOperationalNovelty,
  PreparedProductDisposition,
} from '@authorization/contracts';
import { PageHeader } from '@/components/ui/page-header';
import { Card, CardBody } from '@/components/ui/card';
import { StatusBadge, type PillTone } from '@/components/ui/status-badge';
import { useRole } from '@/components/layout/role-context';
import { useApiData } from '@/hooks/use-api-data';
import { listOperationalStatuses, markPatientNotApplied } from '@/lib/patient-outcomes-api';
import { PointScopeGuard } from '@/components/point-scope/empty-point-scope';

const statusMeta: Record<string, { label: string; tone: PillTone }> = {
  SCHEDULED: { label: 'Programado', tone: 'blue' },
  APPLIED: { label: 'Aplicado', tone: 'green' },
  NOT_APPLIED: { label: 'No aplicado', tone: 'orange' },
  CANCELLED: { label: 'Cancelado', tone: 'gray' },
};
const priorityMeta: Record<string, { label: string; tone: PillTone }> = {
  CRITICAL: { label: 'Crítica', tone: 'red' },
  HIGH: { label: 'Alta', tone: 'orange' },
  NORMAL: { label: 'Normal', tone: 'green' },
};
const novelties: PatientOperationalNovelty[] = [
  'PATIENT_NO_SHOW',
  'INCORRECT_PRESCRIPTION',
  'PRODUCT_NOT_CONTRACTED',
  'AUTHORIZATION_CANCELLED',
  'INSUFFICIENT_STOCK',
  'RESCHEDULED',
  'OTHER',
];

export function OperationalOutcomesView() {
  const { organizationId, hasPermission } = useRole();
  const canManage = hasPermission('patient_operational_outcomes.manage');
  const statuses = useApiData(() => listOperationalStatuses(organizationId), [organizationId]);
  const [selected, setSelected] = useState<string | null>(null);
  const [novelty, setNovelty] = useState<PatientOperationalNovelty>('PATIENT_NO_SHOW');
  const [observation, setObservation] = useState('');
  const [disposition, setDisposition] = useState<PreparedProductDisposition>('NOT_PREPARED');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    const row = statuses.data?.items.find((item) => item.patientScheduleId === selected);
    if (!row) return;
    setBusy(true);
    setError(null);
    try {
      await markPatientNotApplied(organizationId, row.patientScheduleId, {
        expectedScheduleRevision: row.scheduleRevision,
        noveltyCode: novelty,
        occurredOn: new Date().toISOString().slice(0, 10),
        ...(observation ? { observation } : {}),
        preparedProductDisposition: disposition,
        nonReusableLines: [],
      });
      setSelected(null);
      statuses.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo registrar el resultado.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <PointScopeGuard>
      <main>
        <PageHeader
          title="Resultados operacionales"
          description="Planificación, aplicación y resultado se muestran como conceptos separados."
        />
        <Card>
          <CardBody>
            {statuses.loading && <p>Cargando...</p>}
            {statuses.error && <p role="alert">No se pudo cargar la bandeja.</p>}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr>
                    <th>Paciente</th>
                    <th>Autorización</th>
                    <th>Producto</th>
                    <th>Fecha</th>
                    <th>Planificación</th>
                    <th>Operacional</th>
                    <th>Novedad</th>
                    <th>Disposición</th>
                    <th>Fecha resultado</th>
                    <th>Prioridad</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {statuses.data?.items.map((row) => {
                    const meta = statusMeta[row.operationalStatus]!;
                    const priority =
                      row.priorityLevel === 'CRITICAL'
                        ? priorityMeta.CRITICAL
                        : row.priorityLevel === 'HIGH'
                          ? priorityMeta.HIGH
                          : row.priorityLevel === 'NORMAL'
                            ? priorityMeta.NORMAL
                            : null;
                    return (
                      <tr key={row.patientScheduleId}>
                        <td>
                          {row.patientName ?? 'Sin nombre'}
                          <br />
                          <small>{row.patientDocument ?? 'Sin documento'}</small>
                        </td>
                        <td>{row.authorizationNumber}</td>
                        <td>{row.commercialCode}</td>
                        <td>{row.scheduledDate}</td>
                        <td>{row.planningStatus}</td>
                        <td>
                          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                        </td>
                        <td>{row.noveltyCode ?? '—'}</td>
                        <td>{row.disposition ?? '—'}</td>
                        <td>{row.occurredOn ?? '—'}</td>
                        <td>
                          {priority ? (
                            <StatusBadge tone={priority.tone}>{priority.label}</StatusBadge>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>
                          {canManage && row.operationalStatus === 'SCHEDULED' && (
                            <button
                              type="button"
                              onClick={() => setSelected(row.patientScheduleId)}
                            >
                              Marcar no aplicado
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {selected && (
              <div className="mt-6 space-y-3 border-t pt-4">
                <h2>Marcar no aplicado</h2>
                <label>
                  Motivo
                  <select
                    value={novelty}
                    onChange={(event) =>
                      setNovelty(event.target.value as PatientOperationalNovelty)
                    }
                  >
                    {novelties.map((code) => (
                      <option key={code}>{code}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Observación
                  <textarea
                    value={observation}
                    onChange={(event) => setObservation(event.target.value)}
                  />
                </label>
                <label>
                  Producto preparado
                  <select
                    value={disposition}
                    onChange={(event) =>
                      setDisposition(event.target.value as PreparedProductDisposition)
                    }
                  >
                    <option value="NOT_PREPARED">No preparado</option>
                    <option value="REUSABLE">Reutilizable</option>
                    <option value="NON_REUSABLE">No reutilizable</option>
                  </select>
                </label>
                {error && <p role="alert">{error}</p>}
                <button
                  type="button"
                  disabled={busy || (novelty === 'OTHER' && !observation.trim())}
                  onClick={() => void submit()}
                >
                  {busy ? 'Guardando...' : 'Guardar resultado'}
                </button>
              </div>
            )}
          </CardBody>
        </Card>
      </main>
    </PointScopeGuard>
  );
}
