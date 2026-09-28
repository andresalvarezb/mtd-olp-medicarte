import {
  describe,
  expect,
  it,
} from 'vitest';

import {
  dateValue,
} from './bulk-import.service';


describe(
  'authorization XLSX date normalization',
  () => {
    it(
      'interpreta YYYYMMDD numérico como fecha calendario y no como serial Excel',
      () => {
        expect(
          dateValue(
            20261031,
          ),
        ).toBe(
          '2026-10-31',
        );
      },
    );

    it(
      'normaliza YYYYMMDD textual',
      () => {
        expect(
          dateValue(
            '20261031',
          ),
        ).toBe(
          '2026-10-31',
        );
      },
    );

    it(
      'conserva fecha ISO válida',
      () => {
        expect(
          dateValue(
            '2026-10-31',
          ),
        ).toBe(
          '2026-10-31',
        );
      },
    );

    it(
      'continúa soportando serial Excel real',
      () => {
        expect(
          dateValue(
            45658,
          ),
        ).toBe(
          '2025-01-01',
        );
      },
    );

    it(
      'no convierte YYYYMMDD inválido en una fecha Excel absurda',
      () => {
        expect(
          dateValue(
            20261340,
          ),
        ).toBe(
          '20261340',
        );
      },
    );
  },
);
