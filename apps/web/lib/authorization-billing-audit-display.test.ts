import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  billingAuditColumnLabel,
  billingAuditStatusLabel,
} from './authorization-billing-audit-display';


describe(
  'billingAuditStatusLabel',
  () => {
    it(
      'muestra PENDING como Pendiente',
      () => {
        expect(
          billingAuditStatusLabel(
            'PENDING',
          ),
        ).toBe(
          'Pendiente',
        );
      },
    );


    it(
      'muestra REVIEWED como Revisada',
      () => {
        expect(
          billingAuditStatusLabel(
            'REVIEWED',
          ),
        ).toBe(
          'Revisada',
        );
      },
    );
  },
);


describe(
  'billingAuditColumnLabel',
  () => {
    it(
      'muestra Pendiente para AUTO cerrada pendiente de auditoría',
      () => {
        expect(
          billingAuditColumnLabel({
            operationalStatus:
              'CLOSED',

            billingAuditStatus:
              'PENDING',
          }),
        ).toBe(
          'Pendiente',
        );
      },
    );


    it(
      'muestra Revisada para AUTO cerrada con auditoría finalizada',
      () => {
        expect(
          billingAuditColumnLabel({
            operationalStatus:
              'CLOSED',

            billingAuditStatus:
              'REVIEWED',
          }),
        ).toBe(
          'Revisada',
        );
      },
    );


    it(
      'conserva No disponible mientras la AUTO no esté cerrada',
      () => {
        expect(
          billingAuditColumnLabel({
            operationalStatus:
              'ASSIGNED',

            billingAuditStatus:
              'PENDING',
          }),
        ).toBe(
          'No disponible',
        );
      },
    );
  },
);
