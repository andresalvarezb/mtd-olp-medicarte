import { z } from 'zod';

const commonSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional().or(z.literal('')),
  SENTRY_DSN: z.string().url().optional().or(z.literal('')),
});

const importConfigSchema = {
  IMPORT_MAX_FILE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .max(20 * 1024 * 1024)
    .default(20 * 1024 * 1024),
  IMPORT_PROCESSOR_VERSION: z.coerce.number().int().positive().default(2),
};

const mipresConfigSchema = {
  MIPRES_BASE_URL: z.string().url().optional().or(z.literal('')),
  MIPRES_NIT: z.string().min(1).optional().or(z.literal('')),
  MIPRES_INITIAL_TOKEN: z.string().min(1).optional().or(z.literal('')),
  MIPRES_TIMEOUT_MS: z.coerce.number().int().min(100).default(15_000),
  MIPRES_HTTP_RETRIES: z.coerce.number().int().min(0).max(10).default(2),
  MIPRES_CIRCUIT_BREAKER_THRESHOLD: z.coerce.number().int().min(1).default(5),
  MIPRES_CIRCUIT_BREAKER_COOLDOWN_MS: z.coerce.number().int().min(1000).default(30_000),
  MIPRES_QUEUE_CONCURRENCY: z.coerce.number().int().positive().max(20).default(2),
  MIPRES_MANUAL_RECHECK_DAILY_LIMIT: z.coerce.number().int().positive().default(5),
};

/** Secreto HS256 con >= 256 bits: hex de 64+ caracteres o base64url de 32+ bytes. */
function hasJwtSecretEntropy(value: string): boolean {
  if (value.length >= 64) return true;
  try {
    return Buffer.from(value, 'base64url').length >= 32;
  } catch {
    return false;
  }
}

const authConfigSchema = {
  AUTH_JWT_SECRET: z
    .string()
    .min(43)
    .refine(hasJwtSecretEntropy, 'AUTH_JWT_SECRET must provide at least 256 bits'),
  AUTH_JWT_TTL_SECONDS: z.coerce.number().int().min(300).max(86_400).default(28_800),
  AUTH_BOOTSTRAP_ADMIN_USERNAME: z.string().min(3).max(160).default('foundation-admin'),
  AUTH_BOOTSTRAP_ADMIN_PASSWORD: z.string().min(12).max(128).optional(),
  AUTH_BOOTSTRAP_MTD_GENERAL_PASSWORD: z.string().min(12).max(128).optional(),
  AUTH_BOOTSTRAP_MTD_AUDITORIA_PASSWORD: z.string().min(12).max(128).optional(),
};

const bulkConfigSchema = {
  BULK_QUEUE_CONCURRENCY: z.coerce.number().int().positive().max(20).default(3),
};

export const apiConfigSchema = commonSchema.extend({
  ...importConfigSchema,
  ...mipresConfigSchema,
  ...authConfigSchema,
  PORT: z.coerce.number().int().positive().optional(),
  API_PORT: z.coerce.number().int().positive().default(3001),
  API_PUBLIC_URL: z.string().url(),
  WEB_ORIGIN: z.string().url(),
});

export const workerConfigSchema = commonSchema.extend({
  ...importConfigSchema,
  ...mipresConfigSchema,
  ...bulkConfigSchema,
  IMPORT_QUEUE_CONCURRENCY: z.coerce.number().int().positive().max(20).default(3),
  SCHEDULER_ENABLED: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .default('true'),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(100).default(1000),
});

export type ApiConfig = z.infer<typeof apiConfigSchema>;
export type WorkerConfig = z.infer<typeof workerConfigSchema>;

export function parseApiConfig(environment: NodeJS.ProcessEnv): ApiConfig {
  const config = apiConfigSchema.parse(environment);
  if (config.NODE_ENV === 'production') {
    const secureUrls: Record<string, string> = {
      API_PUBLIC_URL: config.API_PUBLIC_URL,
      WEB_ORIGIN: config.WEB_ORIGIN,
    };
    for (const [name, value] of Object.entries(secureUrls)) {
      if (new URL(value).protocol !== 'https:')
        throw new Error(`${name} must use HTTPS in production`);
    }
  }
  return config;
}

export function parseWorkerConfig(environment: NodeJS.ProcessEnv): WorkerConfig {
  return workerConfigSchema.parse(environment);
}
