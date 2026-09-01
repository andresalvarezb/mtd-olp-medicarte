import { describe, expect, it } from 'vitest';
import { dummyVerify, hashPassword, verifyPassword } from './password';

describe('hashPassword / verifyPassword (argon2id)', () => {
  it('produce un hash PHC argon2id verificable', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash.split('$')).toHaveLength(6);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rechaza la contraseña incorrecta', async () => {
    const hash = await hashPassword('S3cret-Long-Passphrase-x');
    expect(await verifyPassword('otra-contrasena', hash)).toBe(false);
  });

  it('usa salt aleatorio: dos hashes del mismo password difieren', async () => {
    const a = await hashPassword('misma-contrasena-1234');
    const b = await hashPassword('misma-contrasena-1234');
    expect(a).not.toBe(b);
    expect(await verifyPassword('misma-contrasena-1234', a)).toBe(true);
    expect(await verifyPassword('misma-contrasena-1234', b)).toBe(true);
  });

  it('verifyPassword devuelve false ante un hash corrupto sin lanzar', async () => {
    expect(await verifyPassword('x', 'no-es-un-hash')).toBe(false);
  });

  it('dummyVerify no lanza con cualquier contraseña', async () => {
    await expect(dummyVerify('cualquier-contrasena')).resolves.toBeUndefined();
  });
});
