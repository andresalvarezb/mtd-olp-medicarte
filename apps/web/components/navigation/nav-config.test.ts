import { describe, expect, it } from 'vitest';
import { defaultPathForRoles, NAV_SECTIONS, organizationCodeForRole } from './nav-config';

describe('MTD_AUDITOR navigation', () => {
  it('only exposes supports and audit views', () => {
    const visiblePaths = NAV_SECTIONS.flatMap((section) => section.items)
      .filter((item) => item.roles.includes('MTD_AUDITOR'))
      .map((item) => item.href);

    expect(visiblePaths).toEqual(['/soportes', '/auditoria']);
    expect(defaultPathForRoles(['MTD_AUDITOR'])).toBe('/soportes');
  });

  it('uses the MTD organization scope', () => {
    expect(organizationCodeForRole('MTD_AUDITOR')).toBe('MTD');
  });
});
