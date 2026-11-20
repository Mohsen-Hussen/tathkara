import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { CheckInInput } from "@tathkara/shared";
import type { Deps } from "../context.js";
import { authenticated, requireRole, requireUser } from "../plugins/auth.js";
import { listOrganizerEvents } from "../services/catalog.js";
import { checkIn, eventStats, getAttachment, listInbox, listTickets, renderTicketsPdf } from "../services/tickets.js";
import { EventSummarySchema, IdParams, TicketSchema } from "./schemas.js";

export const accountRoutes =
  (deps: Deps): FastifyPluginAsyncZod =>
  async (app) => {
    // Everything here needs a signed-in user; checked before any validation runs.
    app.addHook("onRequest", authenticated);

    app.get("/tickets", { schema: { tags: ["tickets"], response: { 200: z.array(TicketSchema) } } }, (req) =>
      listTickets(deps, requireUser(req).id),
    );

    app.get(
      "/tickets/:id/pdf",
      { schema: { tags: ["tickets"], params: IdParams, produces: ["application/pdf"] } },
      async (req, reply) => {
        const all = await listTickets(deps, requireUser(req).id);
        const ticket = all.find((t) => t.id === req.params.id);
        if (!ticket) return reply.code(404).send({ error: { code: "not_found", message: "Ticket not found." } });
        const pdf = await renderTicketsPdf([ticket]);
        return reply
          .type("application/pdf")
          .header("content-disposition", `inline; filename="${ticket.code}.pdf"`)
          .send(pdf);
      },
    );

    app.get(
      "/inbox",
      {
        schema: {
          tags: ["inbox"],
          summary: "Demo mailbox",
          description: "Emails are stored instead of sent so the demo works without an email provider.",
          response: {
            200: z.array(
              z.object({
                id: z.uuid(),
                subject: z.string(),
                body: z.string(),
                createdAt: z.string(),
                attachment: z.object({ name: z.string(), url: z.string() }).nullable(),
              }),
            ),
          },
        },
      },
      async (req) => {
        const rows = await listInbox(deps, requireUser(req).id);
        return rows.map((m) => ({
          id: m.id,
          subject: m.subject,
          body: m.body,
          createdAt: m.createdAt.toISOString(),
          attachment: m.attachmentName ? { name: m.attachmentName, url: `/api/inbox/${m.id}/attachment` } : null,
        }));
      },
    );

    app.get("/inbox/:id/attachment", { schema: { tags: ["inbox"], params: IdParams } }, async (req, reply) => {
      const file = await getAttachment(deps, requireUser(req).id, req.params.id);
      return reply
        .type("application/pdf")
        .header("content-disposition", `inline; filename="${file.name}"`)
        .send(file.data);
    });

    app.get(
      "/organizer/events",
      { schema: { tags: ["organizer"], response: { 200: z.array(EventSummarySchema) } } },
      (req) => listOrganizerEvents(deps, requireRole(req, "organizer").id),
    );

    app.get(
      "/organizer/events/:id/stats",
      {
        schema: {
          tags: ["organizer"],
          params: IdParams,
          response: {
            200: z.object({
              eventId: z.uuid(),
              title: z.string(),
              revenue: z.number(),
              sold: z.number(),
              held: z.number(),
              available: z.number(),
              checkedIn: z.number(),
              ordersByStatus: z.record(z.string(), z.number()),
              salesByTier: z.array(z.object({ tier: z.string(), sold: z.number(), revenue: z.number() })),
            }),
          },
        },
      },
      (req) => eventStats(deps, requireRole(req, "organizer").id, req.params.id),
    );

    app.post(
      "/organizer/check-in",
      {
        schema: {
          tags: ["organizer"],
          summary: "Admit a ticket at the door",
          body: CheckInInput,
          response: {
            200: z.object({
              eventTitle: z.string(),
              holder: z.string(),
              section: z.string(),
              row: z.string(),
              number: z.number(),
              tier: z.string(),
              checkedInAt: z.string(),
            }),
          },
        },
      },
      (req) => checkIn(deps, requireRole(req, "organizer").id, req.body.code),
    );
  };
