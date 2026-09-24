import { describe, expect, it } from 'vitest';

import {
  assertPurchaseOrderAction,
  derivePurchaseOrderAllowedActions,
  derivePurchaseOrderFieldAccess,
  type PurchaseOrderActor,
} from './purchase-order-access-policy';

const actors: readonly PurchaseOrderActor[] = ['MTD', 'OLP', 'MEDICARTE', 'AUDIT', 'READ_ONLY'];

describe('purchase order access policy', () => {
  it('only MTD can upload purchase orders', () => {
    for (const actor of actors) {
      const actions = derivePurchaseOrderAllowedActions({
        actor,

        status: 'PENDING_OLP',

        olpAccepted: false,
      });

      expect(actions.canUpload).toBe(actor === 'MTD');
    }
  });

  it('only OLP can accept a pending unaccepted order', () => {
    for (const actor of actors) {
      const actions = derivePurchaseOrderAllowedActions({
        actor,

        status: 'PENDING_OLP',

        olpAccepted: false,
      });

      expect(actions.canAcceptOlP).toBe(actor === 'OLP');
    }
  });

  it('OLP has no separate dispatch action after acceptance', () => {
    expect(
      derivePurchaseOrderAllowedActions({
        actor: 'OLP',

        status: 'PENDING_OLP',

        olpAccepted: false,
      }).canRecordDispatch,
    ).toBe(false);

    expect(
      derivePurchaseOrderAllowedActions({
        actor: 'OLP',

        status: 'PENDING_MEDICARTE',

        olpAccepted: true,
      }).canRecordDispatch,
    ).toBe(false);
  });

  it('OLP loses OLP operational actions after acceptance', () => {
    const actions = derivePurchaseOrderAllowedActions({
      actor: 'OLP',

      status: 'PENDING_MEDICARTE',

      olpAccepted: true,
    });

    expect(actions.canAcceptOlP).toBe(false);

    expect(actions.canRecordDispatch).toBe(false);

    expect(actions.canRecordReceipt).toBe(false);
  });

  it('Medicarte receives while pending or partially received', () => {
    expect(
      derivePurchaseOrderAllowedActions({
        actor: 'MEDICARTE',

        status: 'PENDING_MEDICARTE',

        olpAccepted: true,
      }).canRecordReceipt,
    ).toBe(true);

    expect(
      derivePurchaseOrderAllowedActions({
        actor: 'MEDICARTE',

        status: 'RECEIVED_WITH_PENDING',

        olpAccepted: true,
      }).canRecordReceipt,
    ).toBe(true);
  });

  it('Medicarte cannot receive a closed order', () => {
    expect(
      derivePurchaseOrderAllowedActions({
        actor: 'MEDICARTE',

        status: 'RECEIVED',

        olpAccepted: true,
      }).canRecordReceipt,
    ).toBe(false);
  });

  it('MTD cannot accept, dispatch or receive', () => {
    const actions = derivePurchaseOrderAllowedActions({
      actor: 'MTD',

      status: 'PENDING_OLP',

      olpAccepted: false,
    });

    expect(actions.canAcceptOlP).toBe(false);

    expect(actions.canRecordDispatch).toBe(false);

    expect(actions.canRecordReceipt).toBe(false);
  });

  it('auditor and read-only never receive operational actions', () => {
    for (const actor of ['AUDIT', 'READ_ONLY'] as const) {
      const actions = derivePurchaseOrderAllowedActions({
        actor,

        status: 'PENDING_MEDICARTE',

        olpAccepted: true,
      });

      expect(actions.canUpload).toBe(false);

      expect(actions.canAcceptOlP).toBe(false);

      expect(actions.canRecordDispatch).toBe(false);

      expect(actions.canRecordReceipt).toBe(false);
    }
  });

  it('OLP only edits acceptance fields before accepting', () => {
    const pendingFields =
      derivePurchaseOrderFieldAccess({
        actor: 'OLP',

        status: 'PENDING_OLP',

        olpAccepted: false,
      });

    expect(
      pendingFields.requestedQuantity,
    ).toBe('READ');

    expect(
      pendingFields.committedDispatchDate,
    ).toBe('EDIT');

    expect(
      pendingFields.dispatchedQuantity,
    ).toBe('READ');

    expect(
      pendingFields.dispatchDate,
    ).toBe('READ');

    expect(
      pendingFields.receivedQuantity,
    ).toBe('READ');


    const acceptedFields =
      derivePurchaseOrderFieldAccess({
        actor: 'OLP',

        status: 'PENDING_MEDICARTE',

        olpAccepted: true,
      });

    expect(
      acceptedFields.committedDispatchDate,
    ).toBe('READ');

    expect(
      acceptedFields.dispatchedQuantity,
    ).toBe('READ');

    expect(
      acceptedFields.dispatchDate,
    ).toBe('READ');

    expect(
      acceptedFields.receivedQuantity,
    ).toBe('READ');

    expect(
      acceptedFields.receiptDate,
    ).toBe('READ');
  });

  it('Medicarte only edits receipt fields', () => {
    const fields = derivePurchaseOrderFieldAccess({
      actor: 'MEDICARTE',

      status: 'PENDING_MEDICARTE',

      olpAccepted: true,
    });

    expect(fields.requestedQuantity).toBe('READ');

    expect(fields.dispatchedQuantity).toBe('READ');

    expect(fields.dispatchDate).toBe('READ');

    expect(fields.receivedQuantity).toBe('EDIT');

    expect(fields.receiptDate).toBe('EDIT');
  });

  it('backend guard rejects forbidden role/action combinations', () => {
    expect(() =>
      assertPurchaseOrderAction(
        {
          actor: 'MEDICARTE',

          status: 'PENDING_OLP',

          olpAccepted: false,
        },
        'ACCEPT_OLP',
      ),
    ).toThrowError('PURCHASE_ORDER_ACTION_FORBIDDEN');

    expect(() =>
      assertPurchaseOrderAction(
        {
          actor: 'OLP',

          status: 'PENDING_MEDICARTE',

          olpAccepted: true,
        },
        'RECORD_RECEIPT',
      ),
    ).toThrowError('PURCHASE_ORDER_ACTION_FORBIDDEN');

    expect(() =>
      assertPurchaseOrderAction(
        {
          actor: 'MTD',

          status: 'PENDING_OLP',

          olpAccepted: false,
        },
        'ACCEPT_OLP',
      ),
    ).toThrowError('PURCHASE_ORDER_ACTION_FORBIDDEN');
  });

  it('allows valid actor/action combinations', () => {
    expect(() =>
      assertPurchaseOrderAction(
        {
          actor: 'MTD',

          status: 'PENDING_OLP',

          olpAccepted: false,
        },
        'UPLOAD',
      ),
    ).not.toThrow();

    expect(() =>
      assertPurchaseOrderAction(
        {
          actor: 'OLP',

          status: 'PENDING_OLP',

          olpAccepted: false,
        },
        'ACCEPT_OLP',
      ),
    ).not.toThrow();

    expect(() =>
      assertPurchaseOrderAction(
        {
          actor: 'MEDICARTE',

          status: 'PENDING_MEDICARTE',

          olpAccepted: true,
        },
        'RECORD_RECEIPT',
      ),
    ).not.toThrow();
  });

});
