import { FIELD_KEY_LENGTH } from '../modules/privacy/fieldCipher';
import { parseServiceScope, ServiceScope } from '../modules/routing/serviceScope';

export type DataStoreConfig =
  | { readonly kind: 'sql'; readonly connectionString: string }
  | { readonly kind: 'memory' };

export interface AppConfig {
  readonly serviceScope: ServiceScope;
  readonly fieldEncryptionKey: Buffer;
  readonly fieldHashKey: Buffer;
  readonly dataStore: DataStoreConfig;
}

export class ConfigError extends Error {}

let cachedConfig: AppConfig | undefined;

export function getConfig(): AppConfig {
  cachedConfig ??= loadConfig(process.env);
  return cachedConfig;
}

export function loadConfig(env: NodeJS.ProcessEnv): AppConfig {
  return {
    serviceScope: parseServiceScope(required(env, 'SERVICE_SCOPE')),
    fieldEncryptionKey: requiredKey(env, 'FIELD_ENCRYPTION_KEY'),
    fieldHashKey: requiredKey(env, 'FIELD_HASH_KEY'),
    dataStore: loadDataStore(env),
  };
}

/** "memory" is for local development only and is refused inside Azure (WEBSITE_SITE_NAME is set there). */
function loadDataStore(env: NodeJS.ProcessEnv): DataStoreConfig {
  const kind = required(env, 'DATA_STORE');
  if (kind === 'sql') {
    return { kind, connectionString: required(env, 'SQL_CONNECTION_STRING') };
  }
  if (kind === 'memory') {
    if (env.WEBSITE_SITE_NAME) {
      throw new ConfigError('DATA_STORE=memory is not allowed in Azure');
    }
    return { kind };
  }
  throw new ConfigError('DATA_STORE must be "sql" or "memory"');
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
