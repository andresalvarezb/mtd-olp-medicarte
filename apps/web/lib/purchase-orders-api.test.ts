import { afterEach, describe, expect, it, vi } from 'vitest';

import { reassignPurchaseOrderAuthorization } from './purchase-orders-api';

describe('reassignPurchaseOrderAuthorization', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('envía la operación individual con organización y payload JSON', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ acceptedRows: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const input = {
      purchaseOrderCode: 'OC-1',
      originAuthorizationKey: 'AUTO-ORIG',
      destinationAuthorizationKey: 'AUTO-DEST',
      commercialCode: 'ABC',
      quantity: 4,
    };

    await reassignPurchaseOrderAuthorization('org-1', input);

    expect(fetchMock).toHaveBeenCalledOnce();
    const call = fetchMock.mock.calls[0];
    const url = call?.[0];
    const request = call?.[1];
    const requestUrl =
      typeof url === 'string' ? url : url instanceof URL ? url.href : url?.url;
    expect(requestUrl).toContain('/purchase-orders/import/reassign');
    expect(request).toMatchObject({
      method: 'POST',
      body: JSON.stringify(input),
    });
    const headers = new Headers(request?.headers);
    expect(headers.get('X-Organization-Id')).toBe('org-1');
    expect(headers.get('Content-Type')).toBe('application/json');
  });
});
