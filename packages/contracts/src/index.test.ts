import { describe, expect, it } from 'vitest';
import { foundationJobSchema, loginRequestSchema, usernameSchema } from './index';

describe('foundation contracts', () => {
  it('requires a versioned event', () => {
    expect(() => foundationJobSchema.parse({ name: 'foundation.event' })).toThrow();
  });

  it('normalizes usernames before validation', () => {
    expect(usernameSchema.parse(' Admin.User ')).toBe('admin.user');
    expect(loginRequestSchema.safeParse({ username: 'admin', password: '' }).success).toBe(false);
  });
});
