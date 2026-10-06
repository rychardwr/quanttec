import { parseServiceScope, ServiceScope } from '../modules/routing/serviceScope';

export interface AppConfig {
  readonly metaAppSecret: string;
  readonly metaVerifyToken: string;
  readonly serviceScope: ServiceScope;
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
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) {
    throw new ConfigError(`Missing required environment variable ${name}`);
  }
  return value;
}
