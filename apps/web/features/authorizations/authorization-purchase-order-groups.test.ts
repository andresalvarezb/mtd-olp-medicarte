import { describe, expect, it } from 'vitest';
import { groupAuthorizationPurchaseOrders } from './authorization-purchase-order-groups';

const original = {
  id: 'a', purchaseOrderCode: '9363',
  sourceQuantity: 1, availableQuantity: 0,
};
const physical = {
  id: 'b', purchaseOrderCode: '9330',
  sourceQuantity: 0, availableQuantity: 1,
};

describe('OC comercial vs OC para consumir', () => {
  it('consume de 9330 y conserva 9363 como origen', () => {
    const result = groupAuthorizationPurchaseOrders({
      purchaseOrders: [original, physical],
      remainingAuthorizedQuantity: 1,
      remainingAssignedQuantity: 1,
    });
    expect(result.forDelivery.map(
      (po) => po.purchaseOrderCode,
    )).toEqual(['9330']);
    expect(
      result.commercialOrigins[0]?.coveredByOtherOrder,
    ).toBe(true);
  });

  it('una OC sin reserva no puede consumirse', () => {
    const result = groupAuthorizationPurchaseOrders({
      purchaseOrders: [original],
      remainingAuthorizedQuantity: 1,
      remainingAssignedQuantity: 0,
    });
    expect(result.forDelivery).toEqual([]);
  });

  it('no marca cobertura parcial como completa', () => {
    const result = groupAuthorizationPurchaseOrders({
      purchaseOrders: [original, physical],
      remainingAuthorizedQuantity: 2,
      remainingAssignedQuantity: 1,
    });
    expect(
      result.commercialOrigins[0]?.coveredByOtherOrder,
    ).toBe(false);
  });

  it('permite origen comercial y fisico en la misma OC', () => {
    const same = { ...original, availableQuantity: 1 };
    const result = groupAuthorizationPurchaseOrders({
      purchaseOrders: [same],
      remainingAuthorizedQuantity: 1,
      remainingAssignedQuantity: 1,
    });
    expect(result.forDelivery).toEqual([same]);
    expect(
      result.commercialOrigins[0]?.coveredByOtherOrder,
    ).toBe(false);
  });

  it('admite reservas desde varias OC', () => {
    const second = {
      ...physical, id: 'c', purchaseOrderCode: '9331',
    };
    const result = groupAuthorizationPurchaseOrders({
      purchaseOrders: [original, physical, second],
      remainingAuthorizedQuantity: 2,
      remainingAssignedQuantity: 2,
    });
    expect(result.forDelivery).toHaveLength(2);
    expect(
      result.commercialOrigins[0]?.coveredByOtherOrder,
    ).toBe(true);
  });

  it('no muestra stock ya consumido', () => {
    const result = groupAuthorizationPurchaseOrders({
      purchaseOrders: [original],
      remainingAuthorizedQuantity: 0,
      remainingAssignedQuantity: 0,
    });
    expect(result.forDelivery).toEqual([]);
  });
});
