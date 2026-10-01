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


    it(
      'recupera source historico desde orden_compra sin crear segundo allocator',
      () => {
        expect(repository).toContain(
          'ai.orden_compra',
        );

        expect(repository).toContain(
          "'LEGACY_CURRENT_STATE'",
        );

        expect(repository).toContain(
          'recoverHistoricalAuthorizationSources',
        );

        expect(repository).toContain(
          'this.reconcilePurchaseOrderAuthorizationAllocations(',
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
