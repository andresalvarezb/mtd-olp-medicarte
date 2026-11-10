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

  it('permite 50 MiB exclusivamente para carga de autorizaciones', () => {
    const config = parseApiConfig(base);
    expect(config.IMPORT_MAX_FILE_BYTES).toBe(20 * 1024 * 1024);
    expect(config.AUTHORIZATION_IMPORT_MAX_FILE_BYTES).toBe(50 * 1024 * 1024);
    expect(
      parseApiConfig({
        ...base,
        AUTHORIZATION_IMPORT_MAX_FILE_BYTES: String(50 * 1024 * 1024),
      }).AUTHORIZATION_IMPORT_MAX_FILE_BYTES,
    ).toBe(50 * 1024 * 1024);
    expect(() =>
      parseApiConfig({
        ...base,
        AUTHORIZATION_IMPORT_MAX_FILE_BYTES: String(50 * 1024 * 1024 + 1),
      }),
    ).toThrow();
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

  it('defaults reconciliation operations scheduler to disabled', () => {
    const config = parseApiConfig(base);
    expect(config.RECONCILIATION_SCHEDULER_ENABLED).toBe(false);
    expect(config.RECONCILIATION_SCHEDULER_TICK_MS).toBe(60_000);
    expect(config.RECONCILIATION_OPERATION_LEASE_SECONDS).toBe(120);
    expect(config.RECONCILIATION_MAX_ATTEMPTS).toBe(3);
  });

  it('keeps patient master APIs disabled until scope and DP-07 gates are approved', () => {
    const config = parseApiConfig(base);
    expect(config.PATIENT_MASTER_ACCESS_ENABLED).toBe(false);
    expect(config.PATIENT_MASTER_SCOPE_POLICY_APPROVED).toBe(false);
    expect(config.PATIENT_MASTER_DP07_APPROVED).toBe(false);
    expect(() => parseApiConfig({ ...base, PATIENT_MASTER_ACCESS_ENABLED: 'true' })).toThrow();
    expect(() =>
      parseApiConfig({
        ...base,
        PATIENT_MASTER_ACCESS_ENABLED: 'true',
        PATIENT_MASTER_SCOPE_POLICY_APPROVED: 'true',
        PATIENT_MASTER_DP07_APPROVED: 'true',
        PATIENT_MASTER_SCOPE_POLICY_VERSION: 'SYNTHETIC_SCOPE_TEST_V1',
      }),
    ).not.toThrow();
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
    expect(config.RECONCILIATION_SCHEDULER_ENABLED).toBe(false);
    expect(config.MTDOM_PATIENT_LOOKUP_ENABLED).toBe(false);
    expect(config.MTDOM_DP07_APPROVED).toBe(false);
    expect(config.PATIENT_CHANGES_SYNC_INTERVAL_MS).toBe(3_600_000);
  });

  it('keeps the Drive sync scope compatible and accepts recent loads', () => {
    const base = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/authorization',
      REDIS_URL: 'redis://localhost:6379',
    };

    expect(parseWorkerConfig(base).GOOGLE_DRIVE_AUDIT_SYNC_SCOPE).toBe('ALL');
    expect(
      parseWorkerConfig({
        ...base,
        GOOGLE_DRIVE_AUDIT_SYNC_SCOPE: 'RECENT_10_DAYS',
      }).GOOGLE_DRIVE_AUDIT_SYNC_SCOPE,
    ).toBe('RECENT_10_DAYS');
  });

  it('allows configuring the changes scheduler interval without enabling a remote feed', () => {
    const config = parseWorkerConfig({
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:password@localhost:5432/authorization',
      REDIS_URL: 'redis://localhost:6379',
      PATIENT_CHANGES_SYNC_INTERVAL_MS: '7200000',
    });
    expect(config.PATIENT_CHANGES_SYNC_INTERVAL_MS).toBe(7_200_000);
    expect(config.MTDOM_PATIENT_LOOKUP_ENABLED).toBe(false);
    expect(config).not.toHaveProperty('MTDOM_PATIENT_CHANGES_ENABLED');
    expect(config).not.toHaveProperty('MTDOM_PATIENT_CHANGES_URL');
  });

  it('allows enabling reconciliation scheduler explicitly', () => {
    const config = parseWorkerConfig({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:password@database:5432/authorization',
      REDIS_URL: 'redis://redis:6379',
      RECONCILIATION_SCHEDULER_ENABLED: 'true',
    });
    expect(config.RECONCILIATION_SCHEDULER_ENABLED).toBe(true);
  });

  it('requires explicit privacy, identity policy and server token gates before lookup can be enabled', () => {
    const base = {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:password@database:5432/authorization',
      REDIS_URL: 'redis://redis:6379',
      MTDOM_PATIENT_LOOKUP_ENABLED: 'true',
    };
    expect(() => parseWorkerConfig(base)).toThrow();
    expect(() =>
      parseWorkerConfig({
        ...base,
        MTDOM_DP07_APPROVED: 'true',
        MTDOM_PATIENT_IDENTITY_POLICY_VERSION: 'v-test-policy',
        MTDOM_PATIENTS_API_TOKEN: 'mtdpat_synthetic-only',
      }),
    ).not.toThrow();
  });
});
