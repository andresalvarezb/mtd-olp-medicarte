import { describe, expect, it } from 'vitest';
import { SignJWT, decodeJwt } from 'jose';
import type { ApiConfig } from '@authorization/config';
import { JWT_AUDIENCE, JWT_ISSUER, signAccessToken, verifyAccessToken } from './jwt';

const SECRET = 'unit-test-secret-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function config(ttl = 3600): ApiConfig {
  return { AUTH_JWT_SECRET: SECRET, AUTH_JWT_TTL_SECONDS: ttl } as ApiConfig;
}

describe('signAccessToken / verifyAccessToken (HS256 propio)', () => {
  it('emite y verifica un token con sub y username', async () => {
    const signed = await signAccessToken(config(), {
      sub: '40000000-0000-4000-8000-000000000001',
      username: 'admin',
    });
    const decoded = decodeJwt(signed.token);
    expect(decoded.sub).toBe('40000000-0000-4000-8000-000000000001');
    expect(decoded.username).toBe('admin');
    expect(decoded.iss).toBe(JWT_ISSUER);
    expect(decoded.aud).toBe(JWT_AUDIENCE);
    expect(signed.expiresAt).toMatch(/Z$/);
    const claims = await verifyAccessToken(config(), signed.token);
    expect(claims).toEqual({
      sub: '40000000-0000-4000-8000-000000000001',
      username: 'admin',
    });
  });

  it('rechaza un token firmado con otro secreto', async () => {
    const signed = await signAccessToken(config(), { sub: '1', username: 'admin' });
    const other = config();
    (other as { AUTH_JWT_SECRET: string }).AUTH_JWT_SECRET = 'x'.repeat(SECRET.length);
    await expect(verifyAccessToken(other, signed.token)).rejects.toThrow();
  });

  it('rechaza un token manipulado o malformado', async () => {
    await expect(verifyAccessToken(config(), 'no.a.jwt')).rejects.toThrow();
    const signed = await signAccessToken(config(), { sub: '1', username: 'admin' });
    const [header, payload, signature] = signed.token.split('.');
    const tamperedPayload = Buffer.from(
      JSON.stringify({ sub: '2', username: 'attacker', iss: JWT_ISSUER, aud: JWT_AUDIENCE }),
    ).toString('base64url');
    await expect(
      verifyAccessToken(config(), `${header}.${tamperedPayload}.${signature}`.slice(0)),
    ).rejects.toThrow();
    expect(payload).toBeTruthy();
  });

  it('rechaza un token expirado', async () => {
    // firmamos con un expirado en el pasado para provocar la expiración
    const key = new TextEncoder().encode(SECRET);
    const past = Math.floor(Date.now() / 1000) - 60;
    const token = await new SignJWT({ username: 'admin' })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject('1')
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(past - 10)
      .setExpirationTime(past)
      .sign(key);
    await expect(verifyAccessToken(config(), token)).rejects.toThrow();
  });

  it('rechaza un token con issuer o audience ajenos', async () => {
    const key = new TextEncoder().encode(SECRET);
    const now = Math.floor(Date.now() / 1000);
    const wrongIss = await new SignJWT({ username: 'admin' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('1')
      .setIssuer('someone-else')
      .setAudience(JWT_AUDIENCE)
      .setIssuedAt(now)
      .setExpirationTime(now + 3600)
      .sign(key);
    await expect(verifyAccessToken(config(), wrongIss)).rejects.toThrow();
  });
});
