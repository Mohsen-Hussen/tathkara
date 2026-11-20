import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { HoldInput } from "@tathkara/shared";
import type { Deps } from "../context.js";
import { authenticated, requireUser } from "../plugins/auth.js";
import { getEvent, getOrder, listEvents, listOrders } from "../services/catalog.js";
import { cancelHold, createHold } from "../services/booking.js";
import { startCheckout } from "../services/payments.js";
import { ErrorSchema, EventDetailSchema, EventSummarySchema, IdParams, OrderSchema } from "./schemas.js";

export const eventRoutes =
  (deps: Deps): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/events", { schema: { tags: ["events"], response: { 200: z.array(EventSummarySchema) } } }, () =>
      listEvents(deps),
    );

    app.get(
      "/events/:slug",
      {
        schema: {
          tags: ["events"],
          params: z.object({ slug: z.string().max(80) }),
          response: { 200: EventDetailSchema },
        },
      },
      (req) => getEvent(deps, req.params.slug, req.user?.id ?? null),
    );

    app.post(
      "/events/:id/holds",
      {
        // Per account rather than per IP, so many people behind one network aren't throttled together.
        onRequest: authenticated,
        config: { rateLimit: { max: 30, timeWindow: "1 minute", keyGenerator: (req) => req.user?.id ?? req.ip } },
        schema: {
          tags: ["orders"],
          summary: "Hold seats for 10 minutes",
          description:
            "Locks the requested seats with SELECT … FOR UPDATE and creates a pending order. Responds 409 with the conflicting seat ids if any seat was taken first.",
          params: IdParams,
          body: HoldInput,
          response: { 201: OrderSchema, 409: ErrorSchema },
        },
      },
      async (req, reply) => {
        const user = requireUser(req);
        const order = await createHold(deps, user.id, req.params.id, req.body.seatIds);
        return reply.code(201).send(await getOrder(deps, user.id, order.id));
      },
    );

    app.get("/orders", { schema: { tags: ["orders"], response: { 200: z.array(OrderSchema) } } }, (req) =>
      listOrders(deps, requireUser(req).id),
    );

    app.get("/orders/:id", { schema: { tags: ["orders"], params: IdParams, response: { 200: OrderSchema } } }, (req) =>
      getOrder(deps, requireUser(req).id, req.params.id),
    );

    app.delete(
      "/orders/:id",
      {
        onRequest: authenticated,
        schema: { tags: ["orders"], summary: "Release a hold", params: IdParams, response: { 204: z.null() } },
      },
      async (req, reply) => {
        await cancelHold(deps, requireUser(req).id, req.params.id);
        return reply.code(204).send(null);
      },
    );

    app.post(
      "/orders/:id/checkout",
      {
        onRequest: authenticated,
        schema: {
          tags: ["payments"],
          summary: "Start a hosted payment session",
          params: IdParams,
          response: { 200: z.object({ sessionId: z.string(), url: z.string() }) },
        },
      },
      (req) => startCheckout(deps, requireUser(req).id, req.params.id),
    );
  };
