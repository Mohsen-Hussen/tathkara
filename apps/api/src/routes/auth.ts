import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { LoginInput, RegisterInput } from "@tathkara/shared";
import type { Deps } from "../context.js";
import { REFRESH_COOKIE, clearSessionCookies, requireUser, setSessionCookies } from "../plugins/auth.js";
import * as auth from "../services/auth.js";
import { UserSchema } from "./schemas.js";

const SessionResponse = z.object({ user: UserSchema });

export const authRoutes =
  (deps: Deps): FastifyPluginAsyncZod =>
  async (app) => {
    // Brute-force protection on the endpoints that check passwords.
    const strict = { rateLimit: { max: 10, timeWindow: "1 minute" } };

    app.post(
      "/register",
      { config: strict, schema: { tags: ["auth"], body: RegisterInput, response: { 201: SessionResponse } } },
      async (req, reply) => {
        const session = await auth.register(deps, req.body);
        setSessionCookies(reply, deps, session);
        return reply.code(201).send({ user: session.user });
      },
    );

    app.post(
      "/login",
      { config: strict, schema: { tags: ["auth"], body: LoginInput, response: { 200: SessionResponse } } },
      async (req, reply) => {
        const session = await auth.login(deps, req.body);
        setSessionCookies(reply, deps, session);
        return { user: session.user };
      },
    );

    app.post(
      "/refresh",
      {
        config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
        schema: { tags: ["auth"], response: { 200: SessionResponse } },
      },
      async (req, reply) => {
        try {
          const session = await auth.refresh(deps, req.cookies[REFRESH_COOKIE]);
          setSessionCookies(reply, deps, session);
          return { user: session.user };
        } catch (error) {
          clearSessionCookies(reply);
          throw error;
        }
      },
    );

    app.post("/logout", { schema: { tags: ["auth"], response: { 204: z.null() } } }, async (req, reply) => {
      await auth.logout(deps, req.cookies[REFRESH_COOKIE]);
      clearSessionCookies(reply);
      return reply.code(204).send(null);
    });

    app.get("/me", { schema: { tags: ["auth"], response: { 200: SessionResponse } } }, async (req) => ({
      user: requireUser(req),
    }));
  };
