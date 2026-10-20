import { FIELD_KEY_LENGTH } from '../modules/privacy/fieldCipher';
import { parseServiceScope, ServiceScope } from '../modules/routing/serviceScope';

export interface AppConfig {
  readonly metaAppSecret: string;
  readonly metaVerifyToken: string;
  readonly serviceScope: ServiceScope;
  readonly fieldEncryptionKey: Buffer;
  readonly fieldHashKey: Buffer;
}

export class ConfigError extends Error {}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig(process.env);
  return cachedConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    metaAppSecret: required(env, 'META_APP_SECRET'),
    metaVerifyToken: required(env, 'META_VERIFY_TOKEN'),
    serviceScope: parseServiceScope(required(env, 'SERVICE_SCOPE')),
    fieldEncryptionKey: requiredKey(env, 'FIELD_ENCRYPTION_KEY'),
    fieldHashKey: requiredKey(env, 'FIELD_HASH_KEY'),
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable ${name}`);
  }
  return value;
}

/** A base64-encoded 32-byte key. */
function requiredKey(env: NodeJS.ProcessEnv, name: string): Buffer {
  const key = Buffer.from(required(env, name), 'base64');
  if (key.length !== FIELD_KEY_LENGTH) {
    throw new ConfigError(`${name} must be a base64-encoded ${FIELD_KEY_LENGTH}-byte key`);
  }
  return key;
}
