import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque tokens have the shape `<id>.<secret>`: `id` locates the DB record in O(1),
 * `secret` (256 random bits) is only ever stored as a SHA-256 hash.
 * A fast hash is enough here — unlike passwords, the secret has full entropy, so
 * brute-forcing the hash is infeasible and argon2 would only add latency.
 */
export function buildOpaqueToken(id: string): { token: string; hash: string } {
  const secret = randomBytes(32).toString('base64url');
  return { token: `${id}.${secret}`, hash: hashSecret(secret) };
}

export function parseOpaqueToken(token: string): { id: string; secret: string } | null {
  const dot = token.indexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  return { id: token.slice(0, dot), secret: token.slice(dot + 1) };
}

export function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex');
}

/** Constant-time comparison of a raw secret against its stored hash. */
export function secretMatches(secret: string, storedHash: string): boolean {
  const actual = Buffer.from(hashSecret(secret), 'hex');
  const expected = Buffer.from(storedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
