import { SignJWT, jwtVerify } from 'jose';
import type { ApiConfig } from '@authorization/config';

/**
 * ADR-026: la API emite sus propios JWT firmados con HS256. Issuer y audience
 * son constantes de la plataforma: el mismo secreto solo circula entre esta
 * API y su Web. El token NO es la fuente de autoridad: después de verificar la
 * firma, el guard recarga usuario, rol y permisos desde PostgreSQL.
 */
export const JWT_ISSUER = 'mtd-olp-medicarte-api';
export const JWT_AUDIENCE = 'mtd-olp-medicarte-web';

export interface AccessTokenClaims {
  sub: string;
  username: string;
}

export interface SignedAccessToken {
  token: string;
  /** Fecha/hora UTC de expiración en formato ISO 8601. */
  expiresAt: string;
}

function secretKey(config: ApiConfig): Uint8Array {
  return new TextEncoder().encode(config.AUTH_JWT_SECRET);
}

export async function signAccessToken(
  config: ApiConfig,
  claims: AccessTokenClaims,
): Promise<SignedAccessToken> {
  const key = secretKey(config);
  const ttl = config.AUTH_JWT_TTL_SECONDS;
  const issuedAt = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({ username: claims.username })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + ttl)
    .sign(key);
  return { token, expiresAt: new Date((issuedAt + ttl) * 1000).toISOString() };
}

export async function verifyAccessToken(
  config: ApiConfig,
  token: string,
): Promise<AccessTokenClaims> {
  const key = secretKey(config);
  const { payload } = await jwtVerify(token, key, {
    issuer: JWT_ISSUER,
    audience: JWT_AUDIENCE,
    algorithms: ['HS256'],
  });
  if (!payload.sub || typeof payload.username !== 'string') {
    throw new Error('Incomplete access token claims');
  }
  return { sub: payload.sub, username: payload.username };
}
