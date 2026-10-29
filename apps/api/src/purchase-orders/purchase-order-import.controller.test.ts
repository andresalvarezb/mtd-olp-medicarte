import { describe, expect, it, vi } from 'vitest';
import { purchaseOrderReassignmentFixture as fixture } from '../../../../tests/fixtures/purchase-order-reassignment';

import { PurchaseOrderImportController } from './purchase-order-import.controller';

function setup(isFoundationAdmin: boolean) {
  const importer = {
    reassignSingle: vi.fn().mockResolvedValue({ acceptedRows: 1 }),
  };
  const access = {
    requirePermission: vi.fn().mockResolvedValue({
      ...(isFoundationAdmin ? fixture.adminProfile : fixture.nonAdminProfile),
    }),
  };
  const controller = new PurchaseOrderImportController(importer as never, access as never);
  const request = {
    auth: {
      sub: isFoundationAdmin ? fixture.adminUserId : fixture.nonAdminUserId,
      username: 'dummy-user',
    },
    correlationId: 'test-correlation',
  } as never;

  return { controller, importer, access, request };
}

const validInput = {
  purchaseOrderCode: ` ${fixture.purchaseOrder.code} `,
  originAuthorizationKey: ` ${fixture.origin.authorizationKey} `,
  destinationAuthorizationKey: ` ${fixture.destination.authorizationKey} `,
  commercialCode: ` ${fixture.line.commercialCode} `,
  quantity: fixture.origin.quantity,
};

describe('PurchaseOrderImportController.reassign', () => {
  it('requiere Scope.isFoundationAdmin incluso si ya tiene purchase_orders.manage', async () => {
    const { controller, importer, access, request } = setup(false);

    await expect(
      controller.reassign(validInput, ORGANIZATION_ID, request),
    ).rejects.toMatchObject({ status: 403 });

    expect(access.requirePermission).toHaveBeenCalledWith(
      USER_ID,
      ORGANIZATION_ID,
      'purchase_orders.manage',
    );
    expect(importer.reassignSingle).not.toHaveBeenCalled();
  });

  it('recorta el payload válido y llama al servicio para el administrador', async () => {
    const { controller, importer, request } = setup(true);

    await expect(
      controller.reassign(validInput, ORGANIZATION_ID, request),
    ).resolves.toEqual({ acceptedRows: 1 });

    expect(importer.reassignSingle).toHaveBeenCalledWith({
      purchaseOrderCode: 'OC-1',
      originAuthorizationKey: 'AUTO-ORIG',
      destinationAuthorizationKey: 'AUTO-DEST',
      commercialCode: 'ABC',
      quantity: 4,
    }, expect.objectContaining({ isFoundationAdmin: true }));
  });

  it('rechaza cantidades fraccionarias y propiedades adicionales antes del servicio', async () => {
    const { controller, importer, request } = setup(true);

    await expect(
      controller.reassign({ ...validInput, quantity: 1.5 }, ORGANIZATION_ID, request),
    ).rejects.toThrow();
    await expect(
      controller.reassign({ ...validInput, extra: true }, ORGANIZATION_ID, request),
    ).rejects.toThrow();

    expect(importer.reassignSingle).not.toHaveBeenCalled();
  });
});
