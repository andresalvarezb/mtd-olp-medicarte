import { randomBytes } from 'node:crypto';
import { argon2id, argon2Verify } from 'hash-wasm';

/**
 * ADR-026: las contraseñas se almacenan exclusivamente como hash Argon2id en
 * formato PHC ($argon2id$v=19$m=...,t=...,p=...$salt$hash). El hash nunca se
 * registra en logs, auditoría ni payloads de respuesta.
 *
 * Parámetros: perfil recomendado por OWASP/RFC 9106 para argon2id (memoria
 * 19 MiB, 2 pasadas, paralelismo 1). hash-wasm evita binarios nativos en las
 * imágenes node slim.
 */
const ARGON2_MEMORY_KIB = 19_456;
const ARGON2_ITERATIONS = 2;
const ARGON2_PARALLELISM = 1;
const ARGON2_HASH_LENGTH = 32;
const ARGON2_SALT_LENGTH = 16;

/**
 * Hash Argon2id válido y fijo. Se verifica con cualquier contraseña para
 * igualar el costo temporal de los intentos contra usernames inexistentes o
 * sin credencial local, evitando enumeración por temporización.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$MDEyMzQ1Njc4OWFiY2RlZg$GMIHcs8sAvYq4TZVe5ymEBrpEzh65NAljeQNWMGp5sE';

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(randomBytes(ARGON2_SALT_LENGTH));
  return argon2id({
    password,
    salt,
    parallelism: ARGON2_PARALLELISM,
    iterations: ARGON2_ITERATIONS,
    memorySize: ARGON2_MEMORY_KIB,
    hashLength: ARGON2_HASH_LENGTH,
    outputType: 'encoded',
  });
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  try {
    return await argon2Verify({ password, hash: storedHash });
  } catch {
    return false;
  }
}

/**
 * Verificación de costo equivalente para usuarios inexistentes o sin
 * contraseña local: iguala el tiempo de respuesta y evita revelar si el
 * username existe (enumeración por temporización).
 */
export async function dummyVerify(password: string): Promise<void> {
  await verifyPassword(password, DUMMY_PASSWORD_HASH);
}
