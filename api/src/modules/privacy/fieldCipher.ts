import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

export const FIELD_KEY_LENGTH = 32;

const FORMAT_VERSION = 1;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const HEADER_LENGTH = 1 + IV_LENGTH + AUTH_TAG_LENGTH;

/**
 * Application-level encryption for personal data columns (CPF, RG).
 * Stored layout: version (1 byte) | IV (12) | GCM auth tag (16) | ciphertext.
 * The version byte leaves room for key rotation.
 */
export class FieldCipher {
  constructor(
    private readonly encryptionKey: Buffer,
    private readonly hashKey: Buffer,
  ) {
    assertKeyLength(encryptionKey, 'encryption');
    assertKeyLength(hashKey, 'hash');
  }

  encrypt(plaintext: string): Buffer {
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([Buffer.of(FORMAT_VERSION), iv, cipher.getAuthTag(), ciphertext]);
  }

  decrypt(stored: Buffer): string {
    if (stored.length < HEADER_LENGTH || stored[0] !== FORMAT_VERSION) {
      throw new Error('Unsupported encrypted field format');
    }
    const iv = stored.subarray(1, 1 + IV_LENGTH);
    const authTag = stored.subarray(1 + IV_LENGTH, HEADER_LENGTH);
    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(stored.subarray(HEADER_LENGTH)), decipher.final()]).toString('utf8');
  }

  /** Deterministic keyed hash, for lookups without storing the plain value. */
  hash(value: string): Buffer {
    return createHmac('sha256', this.hashKey).update(value, 'utf8').digest();
  }
}

function assertKeyLength(key: Buffer, purpose: string): void {
  if (key.length !== FIELD_KEY_LENGTH) {
    throw new Error(`The ${purpose} key must be ${FIELD_KEY_LENGTH} bytes`);
  }
}
