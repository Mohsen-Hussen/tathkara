import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { Deps } from "../context.js";
import { events, orders, webhookEvents } from "../db/schema.js";
import { AppError, notFound } from "../lib/errors.js";
import { randomToken } from "../lib/codes.js";
import { markPaymentFailed, settlePayment } from "./booking.js";

/**
 * A small stand-in for a hosted payment provider (think Stripe Checkout): it creates a
 * session, shows a hosted page, and reports the outcome to us through a signed webhook.
 * The API never trusts the browser about payment — only the verified webhook.
 */

export const SIGNATURE_HEADER = "x-tathkara-signature";
const TOLERANCE_SECONDS = 300;

export const WebhookPayload = z.object({
  id: z.string().min(1),
  type: z.enum(["payment.succeeded", "payment.failed"]),
  created: z.number().int(),
  data: z.object({ sessionId: z.string(), amount: z.number().int() }),
});
export type WebhookPayload = z.infer<typeof WebhookPayload>;

export function sign(secret: string, body: string, timestamp: number) {
  const mac = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${mac}`;
}

export function verifySignature(secret: string, body: string, header: string | undefined, nowSeconds: number) {
  if (!header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isFinite(timestamp) || !parts.v1) return false;
  if (Math.abs(nowSeconds - timestamp) > TOLERANCE_SECONDS) return false; // replay protection
  const expected = Buffer.from(sign(secret, body, timestamp).split("v1=")[1]!, "hex");
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function startCheckout(deps: Deps, userId: string, orderId: string) {
  const sessionId = `ps_${randomToken(18)}`;
  const [order] = await deps.db
    .update(orders)
    .set({ paymentSessionId: sessionId })
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId), eq(orders.status, "pending")))
    .returning();
  if (!order) throw notFound("Pending order");
  if (order.expiresAt <= deps.now()) throw new AppError(410, "hold_expired", "Your hold has expired.");
  return { sessionId, url: `/pay/${sessionId}` };
}

/** What the hosted payment page shows. */
export async function getSession(deps: Deps, sessionId: string) {
  const [row] = await deps.db
    .select({
      amount: orders.total,
      status: orders.status,
      expiresAt: orders.expiresAt,
      title: events.title,
      orderId: orders.id,
    })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(eq(orders.paymentSessionId, sessionId));
  if (!row) throw notFound("Payment session");
  return row;
}

/** The provider charges the card, then notifies the merchant with a signed webhook. */
export async function completeSession(deps: Deps, sessionId: string, outcome: "succeeded" | "failed") {
  const session = await getSession(deps, sessionId);
  const now = deps.now();
  const payload: WebhookPayload = {
    id: `evt_${randomToken(18)}`,
    type: outcome === "succeeded" ? "payment.succeeded" : "payment.failed",
    created: Math.floor(now.getTime() / 1000),
    data: { sessionId, amount: session.amount },
  };
  const body = JSON.stringify(payload);
  await deps.deliverWebhook(body, sign(deps.config.webhookSecret, body, payload.created));
  return { orderId: session.orderId };
}

/** Webhook endpoint logic: verify, de-duplicate, then settle — all-or-nothing. */
export async function handleWebhook(deps: Deps, rawBody: string, signature: string | undefined) {
  const nowSeconds = Math.floor(deps.now().getTime() / 1000);
  if (!verifySignature(deps.config.webhookSecret, rawBody, signature, nowSeconds)) {
    throw new AppError(400, "invalid_signature", "Webhook signature verification failed.");
  }
  const payload = WebhookPayload.parse(JSON.parse(rawBody));

  if (payload.type === "payment.failed") {
    const inserted = await deps.db
      .insert(webhookEvents)
      .values({ id: payload.id, type: payload.type })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return { duplicate: true as const };
    const [order] = await deps.db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.paymentSessionId, payload.data.sessionId));
    if (order) await markPaymentFailed(deps, order.id);
    return { duplicate: false as const, result: "failed" as const };
  }

  const outcome = await deps.db.transaction(async (tx) => {
    // Recording the event id is part of the transaction: a retry after a crash is processed again,
    // a retry after success is a no-op.
    const inserted = await tx
      .insert(webhookEvents)
      .values({ id: payload.id, type: payload.type })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return null;
    return settlePayment(deps, tx, payload.data.sessionId);
  });
  if (!outcome) return { duplicate: true as const };
  if (outcome.sold) deps.realtime.seatsChanged(outcome.sold.eventId, outcome.sold.seats);
  if (outcome.released?.seats.length) deps.realtime.seatsChanged(outcome.released.eventId, outcome.released.seats);
  return { duplicate: false as const, result: outcome.result };
}
