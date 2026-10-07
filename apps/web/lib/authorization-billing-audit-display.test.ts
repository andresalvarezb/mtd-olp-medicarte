import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  billingAuditColumnLabel,
  billingAuditDisplayStatusLabel,
  billingAuditEvidenceLabel,
  billingAuditResultLabel,
  billingAuditStatusLabel,
} from './authorization-billing-audit-display';


describe(
  'billingAuditDisplayStatusLabel',
  () => {
    const cases = [
      [
        'NOT_AVAILABLE',
        'No disponible',
      ],
      [
        'PENDING_WITHOUT_EVIDENCE',
        'Pendiente · Sin soportes',
      ],
      [
        'PENDING_WITH_EVIDENCE',
        'Pendiente · Con soportes',
      ],
      [
        'COMPLIES_WITHOUT_EVIDENCE',
        'Revisada · Cumple · Sin soportes',
      ],
      [
        'COMPLIES_WITH_EVIDENCE',
        'Revisada · Cumple · Con soportes',
      ],
      [
        'DOES_NOT_COMPLY_WITHOUT_EVIDENCE',
        'Revisada · No cumple · Sin soportes',
      ],
      [
        'DOES_NOT_COMPLY_WITH_EVIDENCE',
        'Revisada · No cumple · Con soportes',
      ],
      [
        'INCONSISTENT',
        'Inconsistente',
      ],
    ] as const;

    it.each(
      cases,
    )(
      '%s -> %s',
      (
        status,
        expected,
      ) => {
        expect(
          billingAuditDisplayStatusLabel(
            status,
          ),
        ).toBe(
          expected,
        );
      },
    );
  },
);


describe(
  'billingAuditStatusLabel',
  () => {
    it(
      'mantiene separado el estado canónico',
      () => {
        expect(
          billingAuditStatusLabel(
            'PENDING',
          ),
        ).toBe(
          'Pendiente',
        );

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
  'billingAuditResultLabel',
  () => {
    it(
      'representa el resultado por separado',
      () => {
        expect(
          billingAuditResultLabel(
            null,
          ),
        ).toBe(
          'Pendiente de decisión',
        );

        expect(
          billingAuditResultLabel(
            'COMPLIES',
          ),
        ).toBe(
          'Cumple',
        );

        expect(
          billingAuditResultLabel(
            'DOES_NOT_COMPLY',
          ),
        ).toBe(
          'No cumple',
        );
      },
    );
  },
);


describe(
  'billingAuditEvidenceLabel',
  () => {
    it(
      'representa presencia de soportes por separado',
      () => {
        expect(
          billingAuditEvidenceLabel(
            0,
          ),
        ).toBe(
          'Sin soportes',
        );

        expect(
          billingAuditEvidenceLabel(
            1,
          ),
        ).toBe(
          'Con soportes',
        );
      },
    );
  },
);


describe(
  'billingAuditColumnLabel',
  () => {
    it(
      'usa la situación derivada del read-model',
      () => {
        expect(
          billingAuditColumnLabel({
            billingAuditDisplayStatus:
              'COMPLIES_WITH_EVIDENCE',
          }),
        ).toBe(
          'Revisada · Cumple · Con soportes',
        );
      },
    );
  },
);
