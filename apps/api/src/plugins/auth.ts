import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Role, User } from "@tathkara/shared";
import type { Deps } from "../context.js";
import { forbidden, unauthorized } from "../lib/errors.js";
import { verifyAccessToken } from "../services/auth.js";

export const ACCESS_COOKIE = "tk_at";
export const REFRESH_COOKIE = "tk_rt";

declare module "fastify" {
  interface FastifyRequest {
    user: User | null;
  }
}

/**
 * Tokens live in httpOnly, SameSite=Strict cookies: JavaScript can't read them (XSS) and
 * other sites can't make the browser send them (CSRF). The refresh cookie is scoped to
 * the auth routes so it isn't sent with every request.
 */
export const authPlugin = fp<{ deps: Deps }>(async (app, { deps }) => {
  app.decorateRequest("user", null);
  app.addHook("onRequest", async (req) => {
    const token = req.cookies[ACCESS_COOKIE];
    req.user = token ? await verifyAccessToken(deps, token) : null;
  });
});

/** Route hook: rejects anonymous requests before body validation runs. */
export async function authenticated(req: FastifyRequest) {
  requireUser(req);
}

export function requireUser(req: FastifyRequest): User {
  if (!req.user) throw unauthorized();
  return req.user;
}

export function requireRole(req: FastifyRequest, role: Role): User {
  const user = requireUser(req);
  if (user.role !== role) throw forbidden();
  return user;
}

export function setSessionCookies(
  reply: FastifyReply,
  deps: Deps,
  session: { accessToken: string; refreshToken: string; refreshExpiresAt: Date },
) {
  const base = { httpOnly: true, secure: deps.config.production, sameSite: "strict" as const };
  reply.setCookie(ACCESS_COOKIE, session.accessToken, {
    ...base,
    path: "/",
    maxAge: deps.config.accessTokenTtlSeconds,
  });
  reply.setCookie(REFRESH_COOKIE, session.refreshToken, {
    ...base,
    path: "/api/auth",
    expires: session.refreshExpiresAt,
  });
}

export function clearSessionCookies(reply: FastifyReply) {
  reply.clearCookie(ACCESS_COOKIE, { path: "/" });
  reply.clearCookie(REFRESH_COOKIE, { path: "/api/auth" });
}
