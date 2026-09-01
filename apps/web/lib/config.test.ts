import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { normalizeApiBaseUrl } from './config';

describe('normalizeApiBaseUrl', () => {
  it('adds /api/v1 when the URL is only the host', () => {
    expect(normalizeApiBaseUrl('https://authorization-api-y8g4.onrender.com')).toBe(
      'https://authorization-api-y8g4.onrender.com/api/v1',
    );
  });

  it('keeps a URL that already ends in /api/v1', () => {
    expect(normalizeApiBaseUrl('https://authorization-api-y8g4.onrender.com/api/v1')).toBe(
      'https://authorization-api-y8g4.onrender.com/api/v1',
    );
  });

  it('strips trailing slashes before normalizing', () => {
    expect(normalizeApiBaseUrl('https://authorization-api.onrender.com/')).toBe(
      'https://authorization-api.onrender.com/api/v1',
    );
    expect(normalizeApiBaseUrl('https://authorization-api.onrender.com/api/v1///')).toBe(
      'https://authorization-api.onrender.com/api/v1',
    );
  });

  it('preserves the local development fallback shape', () => {
    expect(normalizeApiBaseUrl('http://localhost:3001/api/v1')).toBe(
      'http://localhost:3001/api/v1',
    );
    expect(normalizeApiBaseUrl('http://localhost:3001')).toBe('http://localhost:3001/api/v1');
  });
});

describe('API_BASE_URL', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.resetModules();
    originalEnv = process.env.NEXT_PUBLIC_API_URL;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_API_URL;
    } else {
      process.env.NEXT_PUBLIC_API_URL = originalEnv;
    }
  });

  it('defaults to the local API when NEXT_PUBLIC_API_URL is not set', async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const config = await import('./config');
    expect(config.API_BASE_URL).toBe('http://localhost:3001/api/v1');
  });

  it('normalizes a host-only NEXT_PUBLIC_API_URL from Render', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'https://authorization-api-custom.onrender.com';
    const config = await import('./config');
    expect(config.API_BASE_URL).toBe('https://authorization-api-custom.onrender.com/api/v1');
  });

  it('keeps a complete NEXT_PUBLIC_API_URL untouched', async () => {
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:3001/api/v1';
    const config = await import('./config');
    expect(config.API_BASE_URL).toBe('http://localhost:3001/api/v1');
  });
});
