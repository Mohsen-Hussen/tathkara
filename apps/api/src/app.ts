import path from "node:path";
import { existsSync } from "node:fs";
import Fastify, { type FastifyServerOptions } from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import fastifyStatic from "@fastify/static";
import {
  hasZodFastifySchemaValidationErrors,
  isResponseSerializationError,
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import type { Deps } from "./context.js";
import { AppError } from "./lib/errors.js";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./routes/auth.js";
import { eventRoutes } from "./routes/events.js";
import { mockProviderRoutes, webhookRoutes } from "./routes/payments.js";
import { accountRoutes } from "./routes/account.js";

export async function buildApp(deps: Deps, options: FastifyServerOptions = {}) {
  const app = Fastify({
    logger: {
      level: deps.config.logLevel,
      redact: ["req.headers.cookie", "req.headers.authorization", 'res.headers["set-cookie"]'],
      ...(deps.config.production || deps.config.env === "test" ? {} : { transport: { target: "pino-pretty" } }),
    },
    trustProxy: deps.config.production,
    ...options,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:"],
        "connect-src": ["'self'", "ws:", "wss:"],
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  await app.register(authPlugin, { deps });

  await app.register(swagger, {
    openapi: {
      info: {
        title: "Tathkara API",
        version: "1.0.0",
        description:
          "Event ticketing with real-time seat holds. Authentication uses httpOnly cookies set by /api/auth/login.",
      },
      tags: ["auth", "events", "orders", "payments", "tickets", "inbox", "organizer", "mock provider"].map((name) => ({
        name,
      })),
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/api/docs" });

  app.setErrorHandler((error, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.code(400).send({
        error: {
          code: "validation_failed",
          message: "Some fields are invalid.",
          details: error.validation.map((v) => ({ path: v.instancePath, message: v.message })),
        },
      });
    }
    if (error instanceof AppError) {
      return reply
        .code(error.statusCode)
        .send({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (isResponseSerializationError(error)) req.log.error({ err: error }, "response did not match its schema");
    const status = (error as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) req.log.error({ err: error }, "unhandled error");
    return reply.code(status).send({
      error: {
        code: status === 429 ? "rate_limited" : status >= 500 ? "internal_error" : "bad_request",
        message: status >= 500 ? "Something went wrong on our side." : (error as Error).message,
      },
    });
  });

  app.get("/api/health", { schema: { hide: true } }, async () => {
    await deps.db.execute(sql`select 1`);
    return { status: "ok" };
  });

  await app.register(authRoutes(deps), { prefix: "/api/auth" });
  await app.register(eventRoutes(deps), { prefix: "/api" });
  await app.register(accountRoutes(deps), { prefix: "/api" });
  await app.register(mockProviderRoutes(deps), { prefix: "/api/mock-pay" });
  await app.register(webhookRoutes(deps), { prefix: "/api/webhooks" });

  // In production the API also serves the React build, so the whole app is one origin.
  const webDist = deps.config.webDist && path.resolve(deps.config.webDist);
  if (webDist && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false, maxAge: "1h" });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/socket.io")) {
        return reply.header("cache-control", "no-cache").sendFile("index.html");
      }
      return reply.code(404).send({ error: { code: "not_found", message: "Route not found." } });
    });
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: "not_found", message: "Route not found." } }),
    );
  }

  return app;
}

export type App = Awaited<ReturnType<typeof buildApp>>;
