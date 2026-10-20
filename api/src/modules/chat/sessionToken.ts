import { createHash, randomBytes } from 'node:crypto';

export const SESSION_TTL_DAYS = 30;

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes in base64url, no padding

export interface SessionToken {
  /** Given to the browser once; never stored. */
  readonly token: string;
  readonly tokenHash: Buffer;
}

export function createSessionToken(): SessionToken {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

/** A plain SHA-256 is enough: the token is 256 random bits, not a guessable secret. */
export function hashSessionToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

export function isWellFormedSessionToken(token: string): boolean {
  return TOKEN_PATTERN.test(token);
}
