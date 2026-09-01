import { describe, expect, it } from 'vitest';
import { parseApiConfig, parseWorkerConfig } from './index';

const JWT_SECRET = 'c0ffee'.repeat(16); // 96 chars, > 256 bits.

const base = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://user:password@database:5432/authorization',
  REDIS_URL: 'redis://redis:6379',
  AUTH_JWT_SECRET: JWT_SECRET,
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

  it('prefers a platform-provided port when present', () => {
    expect(parseApiConfig({ ...base, PORT: '10000', API_PORT: '3001' }).PORT).toBe(10000);
  });

  it('requires a JWT secret with at least 256 bits', () => {
    expect(() => parseApiConfig({ ...base, AUTH_JWT_SECRET: 'short-secret' })).toThrow();
    expect(
      parseApiConfig({ ...base, AUTH_JWT_SECRET: 'A'.repeat(43) }).AUTH_JWT_SECRET.length,
    ).toBe(43);
  });

  it('defaults the local authentication session to eight hours', () => {
    expect(parseApiConfig(base).AUTH_JWT_TTL_SECONDS).toBe(28_800);
    expect(parseApiConfig(base).AUTH_BOOTSTRAP_ADMIN_USERNAME).toBe('foundation-admin');
  });
});

describe('parseWorkerConfig', () => {
  it('no longer requires OIDC variables', () => {
    const config = parseWorkerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:password@database:5432/authorization',
      REDIS_URL: 'redis://redis:6379',
    });
    expect(config.SCHEDULER_ENABLED).toBe(true);
  });
});
