import { z } from 'zod';

const RoleEnum = z.enum(['Reader', 'Writer', 'Admin']);

const EnabledOidc = z.object({
  mode: z.literal('enabled'),
  issuer: z.string().url(),
  audience: z.string().min(1),
  clientId: z.string().min(1),
  scopes: z.array(z.string().min(1)).min(1),
  jwksCacheMin: z.number().int().positive().default(10),
  clockToleranceSec: z.number().int().nonnegative().default(30),
  roleClaim: z.string().min(1).default('role'),
  roleMap: z.record(z.string().min(1), RoleEnum),
});

const DisabledOidc = z.object({
  mode: z.literal('disabled'),
  anonRole: RoleEnum,
});

const ConfigSchema = z.object({
  port: z.number().int().positive().default(3000),
  logLevel: z.string().default('info'),
  authEnabled: z.boolean(),
  oidc: z.discriminatedUnion('mode', [EnabledOidc, DisabledOidc]),
  azure: z.object({
    subscriptions: z.array(z.string()).default([]),
    allowedAccounts: z.array(z.string()).default([]),
    discoveryRefreshMin: z.number().int().positive().default(15),
  }),
  pagination: z.object({
    defaultPageSize: z.number().int().positive().default(200),
    maxPageSize: z.number().int().positive().default(1000),
  }),
  uploads: z.object({
    maxBytes: z.number().int().positive().nullable().default(null),
    streamBlockSizeMb: z.number().int().positive().default(8),
  }),
  swaggerUiEnabled: z.boolean().default(true),
  corsOrigins: z.array(z.string()).default([]),
});

export type Config = z.infer<typeof ConfigSchema>;

const csv = (v: string | undefined): string[] =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : [];

const intOrDefault = (v: string | undefined, d: number): number => {
  if (v === undefined || v === '') return d;
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`expected positive integer, got '${v}'`);
  }
  return n;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const required = (name: string): string => {
    const v = env[name];
    if (v === undefined || v === '') {
      throw new Error(`Missing required env var: ${name}`);
    }
    return v;
  };

  const authEnabled = required('AUTH_ENABLED').toLowerCase() === 'true';

  const oidc =
    authEnabled
      ? {
          mode: 'enabled' as const,
          issuer: required('OIDC_ISSUER'),
          audience: required('OIDC_AUDIENCE'),
          clientId: required('OIDC_CLIENT_ID'),
          scopes: csv(required('OIDC_SCOPES')),
          jwksCacheMin: intOrDefault(env.OIDC_JWKS_CACHE_MIN, 10),
          clockToleranceSec: intOrDefault(env.OIDC_CLOCK_TOLERANCE_SEC, 30),
          roleClaim: env.ROLE_CLAIM ?? 'role',
          roleMap: JSON.parse(required('ROLE_MAP')),
        }
      : {
          mode: 'disabled' as const,
          anonRole: required('ANON_ROLE'),
        };

  const raw = {
    port: intOrDefault(env.PORT, 3000),
    logLevel: env.LOG_LEVEL ?? 'info',
    authEnabled,
    oidc,
    azure: {
      subscriptions: csv(env.AZURE_SUBSCRIPTIONS),
      allowedAccounts: csv(env.ALLOWED_ACCOUNTS),
      discoveryRefreshMin: intOrDefault(env.DISCOVERY_REFRESH_MIN, 15),
    },
    pagination: {
      defaultPageSize: intOrDefault(env.DEFAULT_PAGE_SIZE, 200),
      maxPageSize: intOrDefault(env.MAX_PAGE_SIZE, 1000),
    },
    uploads: {
      maxBytes: env.UPLOAD_MAX_BYTES ? Number(env.UPLOAD_MAX_BYTES) : null,
      streamBlockSizeMb: intOrDefault(env.STREAM_BLOCK_SIZE_MB, 8),
    },
    swaggerUiEnabled: (env.SWAGGER_UI_ENABLED ?? 'true').toLowerCase() !== 'false',
    corsOrigins: csv(env.CORS_ORIGINS),
  };

  return ConfigSchema.parse(raw);
}
