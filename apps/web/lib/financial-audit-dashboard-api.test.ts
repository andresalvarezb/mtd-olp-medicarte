import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { apiRequest } from './api-client';

import {
  getFinancialAuditDashboard,
} from './financial-audit-dashboard-api';

vi.mock('./api-client', () => ({
  apiRequest: vi.fn(),
}));

const organizationId =
  '10000000-0000-4000-8000-000000000001';

describe('Cliente dashboard financiero', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(apiRequest).mockResolvedValue({
      generatedAt: '2026-10-17T14:00:00Z',
      authorizationTotal: 0,
    });
  });

  it('consulta el endpoint con la organización activa', async () => {
    await getFinancialAuditDashboard(organizationId);

    expect(apiRequest).toHaveBeenCalledWith(
      '/analytics/dashboard/financial-audit',
      { organizationId },
    );
  });

  it('propaga AbortSignal para cancelar consultas obsoletas', async () => {
    const controller = new AbortController();

    await getFinancialAuditDashboard(
      organizationId,
      controller.signal,
    );

    expect(apiRequest).toHaveBeenCalledWith(
      '/analytics/dashboard/financial-audit',
      {
        organizationId,
        signal: controller.signal,
      },
    );
  });

  it('propaga errores de la API', async () => {
    vi.mocked(apiRequest).mockRejectedValueOnce(
      new Error('Acceso denegado'),
    );

    await expect(
      getFinancialAuditDashboard(organizationId),
    ).rejects.toThrow('Acceso denegado');
  });
});
