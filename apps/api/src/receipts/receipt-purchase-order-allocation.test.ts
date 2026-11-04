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
      'permits a post-grace physical top-up only for an attended AUTO with an active source',
      () => {
        const gate = source.indexOf('evaluateAuthorizationFulfillmentWindow({');
        const reject = source.indexOf('!reservationWindow.eligibleForNewReservation', gate);
        const insert = source.slice(reject).search(/insert\s+into\s+inventory_authorization_allocations/i);

        expect(gate).toBeGreaterThan(-1);
        expect(reject).toBeGreaterThan(gate);
        expect(insert).toBeGreaterThan(-1);
        expect(source).toContain('currentBogotaDate()');
        expect(source).toContain('hasConfirmedAttention: fulfilledQuantity > 0');
        expect(source).toContain('and poas.released_at is null');
        expect(source).toContain('remainingAuthorizedQuantity');
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
      'permite asignación parcial acotada por compromiso, saldo autorizado e inventario físico',
      () => {
        expect(source).toContain('remainingPurchaseCommitment');
        expect(source).toContain('unreservedAuthorizedQuantity');
        expect(source).toMatch(/const quantity = Math\.min\([\s\S]{0,180}available,/);
        expect(source).toMatch(/wholeAuthorization:\s*false/);
      },
    );

    it(
      'permite completar progresivamente la misma fuente activa sin exceder su snapshot',
      () => {
        const start =
          source.indexOf(
            'const candidates =',
          );

        const end = source.indexOf('order by', start);

        const candidateSql =
          source.slice(
            start,
            end,
          );

        expect(candidateSql).toContain('source_quantity_snapshot');
        expect(candidateSql).toContain('poas.released_at is null');
        expect(candidateSql).not.toMatch(/not\s+exists[\s\S]{0,220}inventory_authorization_allocations/i);
        expect(source).toContain('purchase_order_committed_quantity');
        expect(source).toContain('iaa.purchase_order_id = ${purchaseOrderId}');
        expect(source).toMatch(/from\s+inventory_authorization_allocations[\s\S]{0,260}authorization_item_id = ai\.id/);
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
      'la recepcion legacy confirmada tambien materializa allocation OC -> AUTO',
      () => {
        const confirmStart =
          source.indexOf(
            'async confirm(',
          );

        const directReceiptStart =
          source.indexOf(
            'async createPurchaseOrderReceipt(',
            confirmStart,
          );

        const legacyConfirm =
          source.slice(
            confirmStart,
            directReceiptStart,
          );

        expect(confirmStart).toBeGreaterThan(-1);
        expect(directReceiptStart).toBeGreaterThan(
          confirmStart,
        );

        expect(legacyConfirm).toContain(
          'reconcilePurchaseOrderAuthorizationAllocations(',
        );

        expect(source).toContain(
          'rl.accepted_quantity',
        );

        expect(source).toContain(
          'purchase_order_receipt_lines',
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


    it(
      'el backfill general reutiliza exactamente el reconciliador OC -> AUTO',
      () => {
        const start =
          source.indexOf(
            'async reconcileReceivedPurchaseOrders(',
          );

        const end =
          source.indexOf(
            'list(scope:',
            start,
          );

        expect(start).toBeGreaterThan(-1);
        expect(end).toBeGreaterThan(start);

        const backfill =
          source.slice(
            start,
            end,
          );

        expect(backfill).toContain(
          'this.reconcilePurchaseOrderAllocations(',
        );

        expect(backfill).toContain(
          'purchase_order_authorization_sources',
        );

        expect(backfill).toContain(
          'purchase_order_receipt_lines',
        );

        expect(backfill).toContain(
          'receipt_lines',
        );

        /*
         * El backfill no puede implementar un segundo
         * INSERT de allocations.
         */
        expect(backfill).not.toContain(
          'insert into\n            inventory_authorization_allocations',
        );
      },
    );


    it(
      'una allocation creada durante recepcion invalida AUTHORIZATIONS e INVENTORY',
      () => {
        expect(source).toContain(
          'private async emitAllocationInvalidation(',
        );

        const legacyStart =
          source.indexOf(
            'async confirm(',
          );

        const directStart =
          source.indexOf(
            'async createPurchaseOrderReceipt(',
            legacyStart,
          );

        const allocatorStart =
          source.indexOf(
            'private async reconcilePurchaseOrderAuthorizationAllocations(',
            directStart,
          );

        const legacy =
          source.slice(
            legacyStart,
            directStart,
          );

        const direct =
          source.slice(
            directStart,
            allocatorStart,
          );

        expect(legacy).toContain(
          'this.emitAllocationInvalidation(',
        );

        expect(direct).toContain(
          'this.emitAllocationInvalidation(',
        );

        expect(source).toContain(
          "'AUTHORIZATIONS'",
        );

        expect(source).toContain(
          "'INVENTORY'",
        );
      },
    );

  },
);
