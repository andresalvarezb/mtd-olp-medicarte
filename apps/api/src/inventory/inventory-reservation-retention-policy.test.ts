import {
  readFileSync,
} from 'node:fs';

import {
  resolve,
} from 'node:path';

import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  InventoryAvailabilityRepository,
} from './inventory-availability.repository';


describe(
  'inventory reservation retention policy',
  () => {
    it(
      'reconcileIneligibleTx no libera allocations',
      async () => {
        const execute =
          vi.fn();

        const repository =
          new InventoryAvailabilityRepository(
            {} as never,
          );

        const reconcile =
          (
            repository as unknown as {
              reconcileIneligibleTx(
                tx:
                  unknown,

                scope:
                  unknown,
              ): Promise<number>;
            }
          )
            .reconcileIneligibleTx
            .bind(
              repository,
            );


        await expect(
          reconcile(
            {
              execute,
            },
            {},
          ),
        ).resolves.toBe(
          0,
        );

        expect(
          execute,
        ).not.toHaveBeenCalled();
      },
    );


    it(
      'patient_application consume antes de confirmar',
      () => {
        const source =
          readFileSync(
            resolve(
              process.cwd(),
              'src/applications/patient-application.repository.ts',
            ),
            'utf8',
          );

        const start =
          source.indexOf(
            '  async confirm(',
          );

        const end =
          source.indexOf(
            '\n  async cancel(',
            start,
          );

        expect(
          start,
        ).toBeGreaterThanOrEqual(
          0,
        );

        expect(
          end,
        ).toBeGreaterThan(
          start,
        );

        const confirm =
          source.slice(
            start,
            end,
          );

        const consume =
          confirm.indexOf(
            'await this.consumeInventoryAllocations(',
          );

        const confirmed =
          confirm.indexOf(
            "status='CONFIRMED'",
          );

        expect(
          consume,
        ).toBeGreaterThanOrEqual(
          0,
        );

        expect(
          confirmed,
        ).toBeGreaterThan(
          consume,
        );
      },
    );


    it(
      'consumo no convierte la reserva en RELEASED',
      () => {
        const source =
          readFileSync(
            resolve(
              process.cwd(),
              'src/applications/patient-application.repository.ts',
            ),
            'utf8',
          );

        const start =
          source.indexOf(
            '  private async consumeInventoryAllocations(',
          );

        const end =
          source.indexOf(
            '\n  private async audit(',
            start,
          );

        expect(
          start,
        ).toBeGreaterThanOrEqual(
          0,
        );

        expect(
          end,
        ).toBeGreaterThan(
          start,
        );

        const method =
          source.slice(
            start,
            end,
          );

        expect(
          method,
        ).toContain(
          'consumed_quantity',
        );

        expect(
          method,
        ).toContain(
          "'CONSUMED'",
        );

        expect(
          method,
        ).not.toContain(
          "'RELEASED'",
        );
      },
    );


    it(
      'recepcion posterior al vencimiento conserva AUTO fuente',
      () => {
        const source =
          readFileSync(
            resolve(
              process.cwd(),
              'src/receipts/receipt.repository.ts',
            ),
            'utf8',
          );

        expect(
          source,
        ).not.toContain(
          'candidate.expiration_date >=',
        );
      },
    );
  },
);
