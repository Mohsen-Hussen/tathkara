import { z } from "zod";

const Env = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("postgres://postgres:postgres@localhost:5432/tathkara"),
  /** Signs access tokens. */
  JWT_SECRET: z.string().min(32).optional(),
  /** Signs payment webhooks between the (mock) provider and the API. */
  WEBHOOK_SECRET: z.string().min(16).optional(),
  /** Public origin of the app, used for payment redirects and the webhook URL. */
  PUBLIC_URL: z.string().url().optional(),
  /** Directory with the built web app; served by the API in production. */
  WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SEED_ON_START: z.enum(["true", "false"]).default("false"),
});

const DEV_JWT = "dev-only-jwt-secret-change-me-0123456789";
const DEV_WEBHOOK = "dev-only-webhook-secret";

export type Config = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = Env.parse(env);
  const production = parsed.NODE_ENV === "production";
  if (production && (!parsed.JWT_SECRET || !parsed.WEBHOOK_SECRET)) {
    throw new Error("JWT_SECRET and WEBHOOK_SECRET must be set in production.");
  }
  const publicUrl = parsed.PUBLIC_URL ?? `http://localhost:${parsed.PORT}`;
  return {
    env: parsed.NODE_ENV,
    production,
    port: parsed.PORT,
    host: parsed.HOST,
    databaseUrl: parsed.DATABASE_URL,
    jwtSecret: parsed.JWT_SECRET ?? DEV_JWT,
    webhookSecret: parsed.WEBHOOK_SECRET ?? DEV_WEBHOOK,
    publicUrl,
    webDist: parsed.WEB_DIST,
    logLevel: parsed.LOG_LEVEL,
    seedOnStart: parsed.SEED_ON_START === "true",
    accessTokenTtlSeconds: 15 * 60,
    refreshTokenTtlDays: 14,
  };
}
