import type { OperationalStatusResponse, PatientOperationalStatus } from '@authorization/contracts';
import type { InventoryLotResponse } from '@authorization/contracts';

export function requiresOutcomeObservation(novelty: string, observation: string) {
  return novelty === 'OTHER' && !observation.trim();
}

export function shouldRefreshOutcomeState(status: number, code: string) {
  return status === 409 || code.includes('INSUFFICIENT');
}

export function actionState(status: OperationalStatusResponse | null, planningStatus: string) {
  const operationalStatus =
    status?.operationalStatus ?? (planningStatus === 'CANCELLED' ? 'CANCELLED' : 'SCHEDULED');
  return {
    operationalStatus,
    canApply: operationalStatus === 'SCHEDULED',
    canMarkNotApplied: operationalStatus === 'SCHEDULED',
  } satisfies {
    operationalStatus: PatientOperationalStatus;
    canApply: boolean;
    canMarkNotApplied: boolean;
  };
}

export function eligibleOutcomeLot(
  lot: InventoryLotResponse,
  commercialCode: string,
  dispensingPointId: string,
) {
  return (
    lot.commercialCode === commercialCode &&
    lot.dispensingPointId === dispensingPointId &&
    !lot.expired &&
    lot.usableBalance > 0
  );
}

export function validateNonReusableSelection(
  selections: Record<string, number>,
  lots: InventoryLotResponse[],
  scheduleQuantity: number,
) {
  const selected = Object.entries(selections).filter(([, quantity]) => quantity > 0);
  if (!selected.length) return 'Selecciona al menos un lote y una cantidad.';
  if (
    selected.some(([id, quantity]) => {
      const lot = lots.find((candidate) => candidate.id === id);
      return !lot || quantity > lot.usableBalance;
    })
  )
    return 'La cantidad no puede superar el saldo usable del lote.';
  if (selected.reduce((sum, [, quantity]) => sum + quantity, 0) > scheduleQuantity)
    return 'La cantidad no reutilizable supera la cantidad programada.';
  return null;
}
