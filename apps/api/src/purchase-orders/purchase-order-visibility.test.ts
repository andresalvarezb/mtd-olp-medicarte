import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  derivePurchaseOrderAllowedActions,
} from '@authorization/domain';


describe(
  'purchase order operational visibility',
  () => {
    it(
      'OLP remains observer after supplier acceptance',
      () => {
        for (
          const status of [
            'PENDING_MEDICARTE',
            'RECEIVED_WITH_PENDING',
            'RECEIVED',
          ] as const
        ) {
          const access =
            derivePurchaseOrderAllowedActions({
              actor: 'OLP',
              status,
              olpAccepted: true,
            });

          expect(
            access.canView,
          ).toBe(true);
        }
      },
    );

    it(
      'MEDICARTE starts visibility after OLP acceptance',
      () => {
        expect(
          derivePurchaseOrderAllowedActions({
            actor: 'MEDICARTE',
            status: 'PENDING_OLP',
            olpAccepted: false,
          }).canView,
        ).toBe(false);

        for (
          const status of [
            'PENDING_MEDICARTE',
            'RECEIVED_WITH_PENDING',
            'RECEIVED',
          ] as const
        ) {
          expect(
            derivePurchaseOrderAllowedActions({
              actor: 'MEDICARTE',
              status,
              olpAccepted: true,
            }).canView,
          ).toBe(true);
        }
      },
    );

    it(
      'visibility does not grant cross-actor actions',
      () => {
        const olp =
          derivePurchaseOrderAllowedActions({
            actor: 'OLP',
            status:
              'RECEIVED_WITH_PENDING',
            olpAccepted: true,
          });

        const medicarte =
          derivePurchaseOrderAllowedActions({
            actor: 'MEDICARTE',
            status:
              'RECEIVED_WITH_PENDING',
            olpAccepted: true,
          });

        expect(
          olp.canRecordReceipt,
        ).toBe(false);

        expect(
          medicarte.canRecordReceipt,
        ).toBe(true);
      },
    );
  },
);
