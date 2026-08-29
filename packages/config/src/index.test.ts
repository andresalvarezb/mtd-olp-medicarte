import { describe, expect, it } from 'vitest';
import { parseApiConfig } from './index';

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@database:5432/authorization',
  REDIS_URL: 'redis://redis:6379',
  OIDC_ISSUER: 'https://identity.example.test/realms/authorization',
  OIDC_AUDIENCE: 'authorization-api',
  API_PUBLIC_URL: 'https://api.example.test',
  WEB_ORIGIN: 'https://app.example.test',
};

describe('parseApiConfig', () => {
  it('uses the approved twenty megabyte import limit by default', () => {
    expect(parseApiConfig(base).IMPORT_MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
  });

  it('rejects insecure public production URLs', () => {
    expect(() => parseApiConfig({ ...base, API_PUBLIC_URL: 'http://api.example.test' })).toThrow(
      'API_PUBLIC_URL must use HTTPS in production',
    );
  });
});
