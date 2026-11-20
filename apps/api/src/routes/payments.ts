import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { ORDER_STATUSES } from "@tathkara/shared";
import type { Deps } from "../context.js";
import { SIGNATURE_HEADER, completeSession, getSession, handleWebhook } from "../services/payments.js";

const SessionParams = z.object({ sessionId: z.string().regex(/^ps_[\w-]+$/) });

/** The mock provider's hosted-checkout endpoints (would live on the provider's domain). */
export const mockProviderRoutes =
  (deps: Deps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      "/sessions/:sessionId",
      {
        schema: {
          tags: ["mock provider"],
          params: SessionParams,
          response: {
            200: z.object({
              amount: z.number(),
              title: z.string(),
              status: z.enum(ORDER_STATUSES),
              expiresAt: z.string(),
              orderId: z.uuid(),
            }),
          },
        },
      },
      async (req) => {
        const s = await getSession(deps, req.params.sessionId);
        return { ...s, expiresAt: s.expiresAt.toISOString() };
      },
    );

    app.post(
      "/sessions/:sessionId/complete",
      {
        schema: {
          tags: ["mock provider"],
          params: SessionParams,
          body: z.object({ outcome: z.enum(["succeeded", "failed"]) }),
          response: { 200: z.object({ orderId: z.uuid() }) },
        },
      },
      (req) => completeSession(deps, req.params.sessionId, req.body.outcome),
    );
  };

export const webhookRoutes =
  (deps: Deps): FastifyPluginAsyncZod =>
  async (app) => {
    // Signatures are computed over the exact bytes sent, so keep the raw body.
    app.addContentTypeParser("application/json", { parseAs: "string" }, (_req, body, done) => done(null, body));

    app.post(
      "/payments",
      {
        schema: {
          tags: ["payments"],
          summary: "Payment provider webhook",
          description: `Verifies the HMAC-SHA256 signature in the \`${SIGNATURE_HEADER}\` header (with a 5-minute replay window), ignores event ids it has already processed, and settles the order in one transaction.`,
          response: { 200: z.object({ received: z.literal(true), duplicate: z.boolean() }) },
        },
      },
      async (req) => {
        const result = await handleWebhook(
          deps,
          req.body as string,
          req.headers[SIGNATURE_HEADER] as string | undefined,
        );
        return { received: true as const, duplicate: result.duplicate };
      },
    );
  };
