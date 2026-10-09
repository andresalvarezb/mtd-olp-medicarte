import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiRequest } from './api-client';

import {
  confirmBillingAuditBulk,
  downloadBillingAuditBulkResult,
  downloadBillingAuditBulkTemplate,
  getBillingAuditBulkJob,
  uploadBillingAuditBulk,
} from './authorization-billing-audit-bulk-api';

vi.mock('./api-client', () => ({
  apiRequest: vi.fn(),
}));

const api = vi.mocked(apiRequest);
const base = '/authorization-billing-audits/bulk';

describe('ESP-AUD-BULK-001 frontend HTTP contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.mockResolvedValue({} as never);
  });

  it('descarga la plantilla con contexto de organización', async () => {
    await downloadBillingAuditBulkTemplate('org');

    expect(api).toHaveBeenCalledWith(`${base}/template.xlsx`, {
      organizationId: 'org',
    });
  });

  it('carga XLSX mediante FormData', async () => {
    const file = new File(['contenido'], 'auditoria.xlsx');

    await uploadBillingAuditBulk('org', file);

    const options = api.mock.calls[0]?.[1];
    expect(options?.method).toBe('POST');
    expect(options?.organizationId).toBe('org');
    expect(options?.body).toBeInstanceOf(FormData);

    const form = options?.body;
    if (!(form instanceof FormData)) {
      throw new Error('FORM_DATA_REQUIRED');
    }

    expect(form.get('file')).toBe(file);
  });

  it('consulta lote con paginación explícita', async () => {
    await getBillingAuditBulkJob('org', 'job', 100, 200);

    expect(api).toHaveBeenCalledWith(
      `${base}/jobs/job?limit=100&offset=200`,
      { organizationId: 'org' },
    );
  });

  it('confirma decisiones mediante POST', async () => {
    await confirmBillingAuditBulk('org', 'job');

    expect(api).toHaveBeenCalledWith(
      `${base}/jobs/job/confirm`,
      { method: 'POST', organizationId: 'org' },
    );
  });

  it('descarga el resultado del lote', async () => {
    await downloadBillingAuditBulkResult('org', 'job');

    expect(api).toHaveBeenCalledWith(
      `${base}/jobs/job/result.xlsx`,
      { organizationId: 'org' },
    );
  });
});
