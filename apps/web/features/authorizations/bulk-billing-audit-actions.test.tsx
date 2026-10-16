import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { useRole } from '@/components/layout/role-context';
import { BulkBillingAuditActions } from './bulk-billing-audit-actions';

vi.mock('@/components/layout/role-context', () => ({ useRole: vi.fn() }));

function renderActions(organizationCode: string, permissions: string[]) {
  vi.mocked(useRole).mockReturnValue({
    organizationId: 'org-test',
    me: {
      organizations: [{ id: 'org-test', code: organizationCode }],
    },
    hasPermission: (permission: string) => permissions.includes(permission),
  } as unknown as ReturnType<typeof useRole>);

  return renderToStaticMarkup(createElement(BulkBillingAuditActions));
}

describe('Descarga de plantilla de auditoría', () => {
  it('expone el botón sin abrir carga masiva a quien tenga permiso read', () => {
    const html = renderActions('MTD', ['application_audits.read']);
    expect(html).toContain('Descargar plantilla de auditoría');
    expect(html).not.toContain('Cargar auditoría masiva');
  });

  it('expone descarga y carga a quien tenga solo permiso manage', () => {
    const html = renderActions('MTD', ['application_audits.manage']);
    expect(html).toContain('Descargar plantilla de auditoría');
    expect(html).toContain('Cargar auditoría masiva');
  });

  it('oculta la descarga a usuarios sin permisos u otras organizaciones', () => {
    expect(renderActions('MTD', [])).not.toContain('Descargar plantilla');
    expect(renderActions('OLP', ['application_audits.read'])).not.toContain('Descargar plantilla');
  });
});
