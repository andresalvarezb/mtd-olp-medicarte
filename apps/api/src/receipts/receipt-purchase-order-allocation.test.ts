import {
  describe,
  expect,
  it,
} from 'vitest';

import fs from 'node:fs';
import path from 'node:path';

const repositoryPath =
  path.resolve(
    __dirname,
    'receipt.repository.ts',
  );

const source =
  fs.readFileSync(
    repositoryPath,
    'utf8',
  );

describe(
  'ReceiptRepository - OC -> AUTO allocation contract',
  () => {
    it(
      'usa purchase_order_authorization_sources como autoridad de las AUTO de la OC',
      () => {
        expect(source).toContain(
          'purchase_order_authorization_sources',
        );

        expect(source).toContain(
          'source_quantity_snapshot',
        );
      },
    );

    it(
      'prioriza las AUTO por vencimiento y luego fecha de asignacion',
      () => {
        const expiration =
          source.indexOf(
            'candidate.expiration_date',
            source.indexOf(
              'order by',
              source.indexOf(
                'const candidates',
              ),
            ),
          );

        const assignment =
          source.indexOf(
            'candidate.assignment_date',
            expiration,
          );

        const authorizationKey =
          source.indexOf(
            'candidate.authorization_key',
            assignment,
          );

        const authorizationItem =
          source.indexOf(
            'candidate.authorization_item_id',
            authorizationKey,
          );

        expect(expiration).toBeGreaterThan(-1);
        expect(assignment).toBeGreaterThan(
          expiration,
        );
        expect(authorizationKey).toBeGreaterThan(
          assignment,
        );
        expect(authorizationItem).toBeGreaterThan(
          authorizationKey,
        );
      },
    );

    it(
      'no discrimina las AUTO fuente por estado habilitacion vencimiento fulfillment o aplicacion',
      () => {
        const start =
          source.indexOf(
            'const candidates =',
          );

        const end =
          source.indexOf(
            'Whole-AUTO allocation.',
            start,
          );

        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const candidateSql =
          source.slice(
            start,
            end,
          );

        expect(candidateSql).not.toContain(
          "ai.source_status_normalized =",
        );

        expect(candidateSql).not.toContain(
          "ai.enablement_status =",
        );

        expect(candidateSql).not.toContain(
          'from\n                patient_applications',
        );

        expect(candidateSql).not.toContain(
          'from\n                authorization_fulfillments',
        );

        expect(candidateSql).not.toContain(
          'candidate.expiration_date >=',
        );
      },
    );

    it(
      'mantiene el limite fisico recibido menos ya asignado',
      () => {
        expect(source).toMatch(
          /receivedQuantity\s*-\s*alreadyAssigned/,
        );

        expect(source).toContain(
          'available <=',
        );
      },
    );

    it(
      'mantiene Whole-AUTO y no parte una necesidad mayor al saldo disponible',
      () => {
        expect(source).toMatch(
          /quantity\s*>\s*available/,
        );

        expect(source).toContain(
          'continue;',
        );
      },
    );

    it(
      'evita materializar nuevamente una allocation activa de la misma AUTO OC producto y punto',
      () => {
        const start =
          source.indexOf(
            'const candidates =',
          );

        const end =
          source.indexOf(
            'Whole-AUTO allocation.',
            start,
          );

        const candidateSql =
          source.slice(
            start,
            end,
          );

        expect(candidateSql).toContain(
          'inventory_authorization_allocations',
        );

        expect(candidateSql).toContain(
          'iaa.authorization_item_id',
        );

        expect(candidateSql).toContain(
          'iaa.purchase_order_id',
        );

        expect(candidateSql).toContain(
          'iaa.commercial_code',
        );

        expect(candidateSql).toContain(
          'iaa.dispensing_point_id',
        );
      },
    );

    it(
      'no exige INVIMA exclusivamente numerico para resolver punto',
      () => {
        const numericInvimaGuard =
          /tap\.(numero_expediente_invima|consecutivo_invima_presentacion)[\s\S]{0,180}\^\[0-9\]\+\$/g;

        expect(
          source.match(
            numericInvimaGuard,
          ),
        ).toBeNull();
      },
    );

    it(
      'expone reconciliacion historica reutilizando el mismo allocator',
      () => {
        expect(source).toContain(
          'async reconcilePurchaseOrderAllocations(',
        );

        expect(source).toContain(
          'private async reconcilePurchaseOrderAuthorizationAllocations(',
        );

        const publicStart =
          source.indexOf(
            'async reconcilePurchaseOrderAllocations(',
          );

        const publicEnd =
          source.indexOf(
            'list(scope:',
            publicStart,
          );

        const publicMethod =
          source.slice(
            publicStart,
            publicEnd,
          );

        expect(publicMethod).toContain(
          'this.reconcilePurchaseOrderAuthorizationAllocations(',
        );

        expect(publicMethod).not.toContain(
          'insert into inventory_authorization_allocations',
        );
      },
    );

    it(
      'la recepcion directa ejecuta allocation despues de insertar las lineas recibidas',
      () => {
        const receipt =
          source.indexOf(
            'async createPurchaseOrderReceipt(',
          );

        const insertLine =
          source.indexOf(
            'insert into purchase_order_receipt_lines',
            receipt,
          );

        const allocate =
          source.indexOf(
            'reconcilePurchaseOrderAuthorizationAllocations(',
            insertLine,
          );

        expect(receipt).toBeGreaterThan(-1);
        expect(insertLine).toBeGreaterThan(
          receipt,
        );
        expect(allocate).toBeGreaterThan(
          insertLine,
        );
      },
    );
  },
);
