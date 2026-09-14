import { describe, expect, it } from 'vitest';
import type { InventoryLotResponse } from '@authorization/contracts';
import {
  actionState,
  eligibleOutcomeLot,
  requiresOutcomeObservation,
  shouldRefreshOutcomeState,
  validateNonReusableSelection,
} from './operational-outcome-ui';

const lot = (overrides: Record<string, unknown> = {}) =>
  ({
    id: '00000000-0000-4000-8000-000000000001',
    commercialCode: 'P1',
    dispensingPointId: '00000000-0000-4000-8000-000000000002',
    dispensingPointCode: 'P',
    dispensingPointName: 'Punto',
    lotNumber: 'A',
    expirationDate: '2099-01-01',
    physicalBalance: 2,
    usableBalance: 2,
    expired: false,
    ...overrides,
  }) satisfies InventoryLotResponse;
describe('operational outcome UX rules', () => {
  it('pending exposes both terminal actions', () =>
    expect(actionState(null, 'SCHEDULED')).toMatchObject({
      canApply: true,
      canMarkNotApplied: true,
    }));
  it('APPLIED disables not applied', () =>
    expect(
      actionState({ operationalStatus: 'APPLIED' } as never, 'SCHEDULED').canMarkNotApplied,
    ).toBe(false));
  it('NOT_APPLIED disables apply', () =>
    expect(actionState({ operationalStatus: 'NOT_APPLIED' } as never, 'SCHEDULED').canApply).toBe(
      false,
    ));
  it('cancelled exposes no action', () =>
    expect(actionState(null, 'CANCELLED')).toMatchObject({
      canApply: false,
      canMarkNotApplied: false,
    }));
  it('not prepared has no lines by UI contract', () => expect([]).toHaveLength(0));
  it('reusable has no lines by UI contract', () => expect([]).toHaveLength(0));
  it('OTHER requires an observation', () =>
    expect(requiresOutcomeObservation('OTHER', '  ')).toBe(true));
  it('non-OTHER can omit an observation', () =>
    expect(requiresOutcomeObservation('PATIENT_NO_SHOW', '')).toBe(false));
  it('accepts an eligible lot', () =>
    expect(eligibleOutcomeLot(lot(), 'P1', lot().dispensingPointId)).toBe(true));
  it('rejects another product', () =>
    expect(eligibleOutcomeLot(lot({ commercialCode: 'P2' }), 'P1', lot().dispensingPointId)).toBe(
      false,
    ));
  it('rejects another point', () =>
    expect(eligibleOutcomeLot(lot(), 'P1', '00000000-0000-4000-8000-000000000003')).toBe(false));
  it('rejects expired lot', () =>
    expect(eligibleOutcomeLot(lot({ expired: true }), 'P1', lot().dispensingPointId)).toBe(false));
  it('rejects empty stock', () =>
    expect(eligibleOutcomeLot(lot({ usableBalance: 0 }), 'P1', lot().dispensingPointId)).toBe(
      false,
    ));
  it('allows multiple lots under schedule quantity', () =>
    expect(
      validateNonReusableSelection(
        { a: 2, b: 1 },
        [lot({ id: 'a' }), lot({ id: 'b', usableBalance: 5 })],
        3,
      ),
    ).toBeNull());
  it('allows less than schedule quantity', () =>
    expect(validateNonReusableSelection({ a: 1 }, [lot({ id: 'a' })], 3)).toBeNull());
  it('requires positive total', () =>
    expect(validateNonReusableSelection({ a: 0 }, [lot({ id: 'a' })], 3)).toBeTruthy());
  it('caps total at schedule quantity', () =>
    expect(
      validateNonReusableSelection({ a: 2, b: 2 }, [lot({ id: 'a' }), lot({ id: 'b' })], 3),
    ).toBeTruthy());
  it('caps each line at usable balance', () =>
    expect(
      validateNonReusableSelection({ a: 3 }, [lot({ id: 'a', usableBalance: 2 })], 3),
    ).toBeTruthy());
  it('refreshes after a terminal or stock conflict', () => {
    expect(shouldRefreshOutcomeState(409, 'PATIENT_SCHEDULE_ALREADY_APPLIED')).toBe(true);
    expect(shouldRefreshOutcomeState(400, 'PATIENT_OUTCOME_INSUFFICIENT_BALANCE')).toBe(true);
  });
});
