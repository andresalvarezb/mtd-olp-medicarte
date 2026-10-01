import {
  describe,
  expect,
  it,
} from 'vitest';

import fs from 'node:fs';
import path from 'node:path';


describe(
  'received allocation historical backfill',
  () => {
    const repository =
      fs.readFileSync(
        path.resolve(
          __dirname,
          'receipt.repository.ts',
        ),
        'utf8',
      );

    const bootstrap =
      fs.readFileSync(
        path.resolve(
          __dirname,
          'received-allocation-backfill.bootstrap.ts',
        ),
        'utf8',
      );


    const historicalRecovery =
      fs.readFileSync(
        path.resolve(
          __dirname,
          '../legacy/historical-purchase-order-source-recovery.service.ts',
        ),
        'utf8',
      );


    it(
      'recupera lineage historico en el boundary ESP-016 sin crear segundo allocator',
      () => {
        expect(historicalRecovery).toContain(
          'ai.orden_compra',
        );

        expect(historicalRecovery).toContain(
          "'LEGACY_CURRENT_STATE'",
        );

        expect(repository).not.toContain(
          'ai.orden_compra',
        );

        expect(repository).not.toContain(
          'ai.lugar_dispensacion',
        );

        expect(repository).toContain(
          'historicalSourceRecovery.recoverPage',
        );

        expect(repository).toContain(
          'historicalSourceRecovery.recoverForPurchaseOrder',
        );

        expect(repository).toContain(
          'this.reconcilePurchaseOrderAuthorizationAllocations(',
        );

        expect(historicalRecovery).not.toContain(
          'insert into inventory_authorization_allocations',
        );
      },
    );


    it(
      'pagina el backfill y limita cada lote',
      () => {
        expect(repository).toContain(
          'nextCursor',
        );

        expect(repository).toContain(
          'hasMore',
        );

        expect(repository).toContain(
          '50,',
        );

        expect(bootstrap).toContain(
          'limit:',
        );

        expect(bootstrap).toContain(
          '10,',
        );

        expect(bootstrap).toContain(
          '500,',
        );
      },
    );


    it(
      'solo ejecuta automaticamente en produccion',
      () => {
        expect(bootstrap).toContain(
          "process.env.NODE_ENV !==",
        );

        expect(bootstrap).toContain(
          "'production'",
        );

        expect(bootstrap).toContain(
          'RECEIVED_AUTO_BACKFILL_COMPLETED',
        );
      },
    );
  },
);
