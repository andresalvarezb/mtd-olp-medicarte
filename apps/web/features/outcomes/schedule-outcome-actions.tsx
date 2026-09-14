'use client';

import { useState } from 'react';
import type {
  InventoryLotResponse,
  OperationalStatusResponse,
  PatientOperationalNovelty,
  PreparedProductDisposition,
} from '@authorization/contracts';
import { ApiError } from '@/lib/api-client';
import { listInventory } from '@/lib/inventory-api';
import { markPatientNotApplied } from '@/lib/patient-outcomes-api';
import { useApiData } from '@/hooks/use-api-data';
import {
  actionState,
  eligibleOutcomeLot,
  requiresOutcomeObservation,
  shouldRefreshOutcomeState,
  validateNonReusableSelection,
} from './operational-outcome-ui';

type Schedule = {
  id: string;
  revision: number;
  authorizationNumber: string;
  patientName: string | null;
  patientDocument: string | null;
  commercialCode: string;
  dispensingPointId: string;
  dispensingPointCode: string;
  scheduledDate: string;
  quantity: number;
  status: string;
};
type Props = {
  schedule: Schedule;
  organizationId: string;
  operationalStatus: OperationalStatusResponse | null;
  canManage: boolean;
  canApply: boolean;
  onChanged: () => void;
};
const noveltyCodes: PatientOperationalNovelty[] = [
  'PATIENT_NO_SHOW',
  'INCORRECT_PRESCRIPTION',
  'PRODUCT_NOT_CONTRACTED',
  'AUTHORIZATION_CANCELLED',
  'INSUFFICIENT_STOCK',
  'RESCHEDULED',
  'OTHER',
];

export function ScheduleOutcomeActions({
  schedule,
  organizationId,
  operationalStatus,
  canManage,
  canApply,
  onChanged,
}: Props) {
  const state = actionState(operationalStatus, schedule.status);
  const [open, setOpen] = useState(false);
  const [novelty, setNovelty] = useState<PatientOperationalNovelty>('PATIENT_NO_SHOW');
  const [occurredOn, setOccurredOn] = useState(schedule.scheduledDate);
  const [observation, setObservation] = useState('');
  const [disposition, setDisposition] = useState<PreparedProductDisposition>('NOT_PREPARED');
  const [selections, setSelections] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lots = useApiData(
    () =>
      open && disposition === 'NON_REUSABLE'
        ? listInventory(organizationId, {
            commercialCode: schedule.commercialCode,
            dispensingPointId: schedule.dispensingPointId,
            usable: 'true',
          })
        : Promise.resolve({ items: [] as InventoryLotResponse[] }),
    [open, disposition, organizationId, schedule.commercialCode, schedule.dispensingPointId],
  );
  const eligibleLots = (lots.data?.items ?? []).filter((lot) =>
    eligibleOutcomeLot(lot, schedule.commercialCode, schedule.dispensingPointId),
  );
  const setQuantity = (id: string, value: string) =>
    setSelections((current) => ({ ...current, [id]: Math.max(0, Number(value) || 0) }));
  const submit = async () => {
    if (requiresOutcomeObservation(novelty, observation)) {
      setError('OTHER requiere una observación.');
      return;
    }
    const selected = disposition === 'NON_REUSABLE' ? selections : {};
    const validation =
      disposition === 'NON_REUSABLE'
        ? validateNonReusableSelection(selected, eligibleLots, schedule.quantity)
        : null;
    if (validation) {
      setError(validation);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await markPatientNotApplied(organizationId, schedule.id, {
        expectedScheduleRevision: schedule.revision,
        noveltyCode: novelty,
        occurredOn,
        ...(observation.trim() ? { observation: observation.trim() } : {}),
        preparedProductDisposition: disposition,
        nonReusableLines: Object.entries(selected)
          .filter(([, quantity]) => quantity > 0)
          .map(([inventoryLotId, quantity]) => ({ inventoryLotId, quantity })),
      });
      if (disposition === 'NON_REUSABLE') lots.reload();
      setOpen(false);
      onChanged();
    } catch (cause) {
      if (cause instanceof ApiError && shouldRefreshOutcomeState(cause.status, cause.code)) {
        setError(
          `${cause.code}: el inventario o el resultado cambió. Se refrescaron los saldos; revisa la selección antes de reintentar.`,
        );
        lots.reload();
        onChanged();
      } else
        setError(cause instanceof Error ? cause.message : 'No se pudo registrar el resultado.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="actions" data-testid={`operational-actions-${schedule.id}`}>
      {state.operationalStatus === 'APPLIED' && <span className="pill green">APPLIED</span>}
      {state.operationalStatus === 'NOT_APPLIED' && (
        <span className="pill orange">NOT_APPLIED {operationalStatus?.noveltyCode ?? ''}</span>
      )}
      {state.operationalStatus === 'CANCELLED' && <span className="pill gray">CANCELLED</span>}
      {canApply && state.canApply && (
        <a className="btn" href={`/aplicaciones?patientScheduleId=${schedule.id}`}>
          Aplicar
        </a>
      )}
      {canManage && state.canMarkNotApplied && (
        <button type="button" className="btn" onClick={() => setOpen(true)}>
          Marcar no aplicado
        </button>
      )}
      {open && (
        <div className="panel" role="dialog" aria-label="Marcar no aplicado">
          <p>
            <strong>{schedule.patientName ?? schedule.patientDocument ?? 'Paciente'}</strong> ·{' '}
            {schedule.authorizationNumber}
          </p>
          <p>
            {schedule.commercialCode} · {schedule.quantity} unidades · {schedule.scheduledDate} ·{' '}
            {schedule.dispensingPointCode} · revisión {schedule.revision}
          </p>
          <label>
            Motivo
            <select
              value={novelty}
              onChange={(event) => setNovelty(event.target.value as PatientOperationalNovelty)}
            >
              {noveltyCodes.map((code) => (
                <option key={code}>{code}</option>
              ))}
            </select>
          </label>
          <label>
            Fecha resultado
            <input
              type="date"
              value={occurredOn}
              onChange={(event) => setOccurredOn(event.target.value)}
            />
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
              onChange={(event) => {
                setDisposition(event.target.value as PreparedProductDisposition);
                setError(null);
              }}
            >
              {['NOT_PREPARED', 'REUSABLE', 'NON_REUSABLE'].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {disposition === 'REUSABLE' && (
            <p>El producto continúa disponible en inventario. No se generará consumo de stock.</p>
          )}
          {disposition === 'NON_REUSABLE' && (
            <div>
              <p>Selecciona lotes físicos. El stock no se reserva y se revalida al guardar.</p>
              {lots.loading && <p>Cargando lotes...</p>}
              {eligibleLots.map((lot: InventoryLotResponse) => (
                <label key={lot.id}>
                  {lot.lotNumber} · vence {lot.expirationDate} · usable {lot.usableBalance}
                  <input
                    type="number"
                    min="0"
                    max={lot.usableBalance}
                    value={selections[lot.id] ?? 0}
                    onChange={(event) => setQuantity(lot.id, event.target.value)}
                  />
                </label>
              ))}
            </div>
          )}
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            disabled={busy || requiresOutcomeObservation(novelty, observation)}
            onClick={() => void submit()}
          >
            {busy ? 'Guardando...' : 'Guardar'}
          </button>
          <button type="button" disabled={busy} onClick={() => setOpen(false)}>
            Cerrar
          </button>
        </div>
      )}
    </div>
  );
}
