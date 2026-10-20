import { describe, expect, it } from 'vitest';
import { FieldCipher } from '../src/modules/privacy/fieldCipher';
import { loadConfig } from '../src/shared/config';

const cipher = new FieldCipher(Buffer.alloc(32, 1), Buffer.alloc(32, 2));

describe('FieldCipher', () => {
  it('round-trips a value', () => {
    expect(cipher.decrypt(cipher.encrypt('52998224725'))).toBe('52998224725');
  });

  it('uses a fresh IV, so equal values encrypt differently', () => {
    expect(cipher.encrypt('52998224725').equals(cipher.encrypt('52998224725'))).toBe(false);
  });

  it('rejects tampered ciphertext', () => {
    const stored = cipher.encrypt('52998224725');
    stored[stored.length - 1]! ^= 0xff;
    expect(() => cipher.decrypt(stored)).toThrow();
  });

  it('rejects a value encrypted with another key', () => {
    const other = new FieldCipher(Buffer.alloc(32, 3), Buffer.alloc(32, 2));
    expect(() => cipher.decrypt(other.encrypt('52998224725'))).toThrow();
  });

  it('hashes deterministically with its own key', () => {
    const otherHashKey = new FieldCipher(Buffer.alloc(32, 1), Buffer.alloc(32, 4));
    expect(cipher.hash('52998224725').equals(cipher.hash('52998224725'))).toBe(true);
    expect(cipher.hash('52998224725').equals(otherHashKey.hash('52998224725'))).toBe(false);
  });

  it('refuses keys of the wrong size', () => {
    expect(() => new FieldCipher(Buffer.alloc(16), Buffer.alloc(32))).toThrow();
  });
});

describe('loadConfig', () => {
  const validEnv = {
    SERVICE_SCOPE: 'FINANCEIRO:ITARARE',
    DATA_STORE: 'memory',
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    FIELD_HASH_KEY: Buffer.alloc(32, 2).toString('base64'),
  };

  it('loads a complete environment', () => {
    expect(loadConfig(validEnv).fieldEncryptionKey).toHaveLength(32);
  });

  it('fails on a missing variable', () => {
    expect(() => loadConfig({ ...validEnv, SERVICE_SCOPE: '' })).toThrow(/SERVICE_SCOPE/);
  });

  it('requires a connection string for the sql data store', () => {
    expect(() => loadConfig({ ...validEnv, DATA_STORE: 'sql' })).toThrow(/SQL_CONNECTION_STRING/);
    expect(loadConfig({ ...validEnv, DATA_STORE: 'sql', SQL_CONNECTION_STRING: 'Server=x' }).dataStore.kind).toBe('sql');
  });

  it('refuses the memory data store inside Azure', () => {
    expect(() => loadConfig({ ...validEnv, WEBSITE_SITE_NAME: 'quanttec-func' })).toThrow(/not allowed/);
  });

  it('fails on a key that is not 32 bytes', () => {
    const shortKey = Buffer.alloc(16).toString('base64');
    expect(() => loadConfig({ ...validEnv, FIELD_HASH_KEY: shortKey })).toThrow(/FIELD_HASH_KEY/);
  });
});
