import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { fromDrizzle } from "pg-boss";
import { HOLD_MINUTES, type OrderStatus, type SeatChange } from "@tathkara/shared";
import type { Deps } from "../context.js";
import type { Tx } from "../db/client.js";
import { emails, events, orderSeats, orders, seats, tickets } from "../db/schema.js";
import { AppError, conflict, notFound } from "../lib/errors.js";
import { ticketCode } from "../lib/codes.js";
import { QUEUES } from "../jobs/queues.js";

/**
 * Seat holds and their lifecycle. Every state change happens inside one transaction
 * with the affected rows locked (`FOR UPDATE`), always in seat-id order so two
 * transactions can never wait on each other in a cycle.
 */

type Released = { eventId: string; seats: SeatChange[] };

async function releaseSeats(tx: Tx, orderId: string): Promise<SeatChange[]> {
  const rows = await tx
    .update(seats)
    .set({ status: "available", orderId: null })
    .where(and(eq(seats.orderId, orderId), eq(seats.status, "held")))
    .returning({ id: seats.id });
  return rows.map((r) => ({ id: r.id, status: "available" as const }));
}

/** Locks the order row; returns null when it doesn't exist (or isn't the user's). */
async function lockOrder(tx: Tx, orderId: string, userId?: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(userId ? and(eq(orders.id, orderId), eq(orders.userId, userId)) : eq(orders.id, orderId))
    .for("update");
  return order ?? null;
}

export async function createHold(deps: Deps, userId: string, eventId: string, seatIds: string[]) {
  const now = deps.now();
  const expiresAt = new Date(now.getTime() + HOLD_MINUTES * 60_000);
  const released: SeatChange[] = [];

  const order = await deps.db.transaction(async (tx) => {
    const [event] = await tx.select({ startsAt: events.startsAt }).from(events).where(eq(events.id, eventId));
    if (!event) throw notFound("Event");
    if (event.startsAt <= now) throw new AppError(422, "event_started", "Sales for this event have closed.");

    // One active hold per person per event: picking again replaces the previous hold.
    const previous = await tx
      .select({ id: orders.id })
      .from(orders)
      .where(and(eq(orders.userId, userId), eq(orders.eventId, eventId), eq(orders.status, "pending")))
      .for("update");
    for (const p of previous) {
      await tx.update(orders).set({ status: "cancelled" }).where(eq(orders.id, p.id));
      released.push(...(await releaseSeats(tx, p.id)));
    }

    const locked = await tx
      .select({ id: seats.id, status: seats.status, price: seats.price })
      .from(seats)
      .where(and(eq(seats.eventId, eventId), inArray(seats.id, seatIds)))
      .orderBy(asc(seats.id))
      .for("update");
    if (locked.length !== seatIds.length) throw notFound("Seat");

    const taken = locked.filter((s) => s.status !== "available").map((s) => s.id);
    if (taken.length) {
      throw conflict("seats_unavailable", "Someone else just took one of those seats.", { seatIds: taken });
    }

    const total = locked.reduce((sum, s) => sum + s.price, 0);
    const [created] = await tx.insert(orders).values({ userId, eventId, total, expiresAt }).returning();
    await tx.update(seats).set({ status: "held", orderId: created!.id }).where(inArray(seats.id, seatIds));
    await tx.insert(orderSeats).values(locked.map((s) => ({ orderId: created!.id, seatId: s.id, price: s.price })));

    // Enqueued in the same transaction: if the hold rolls back, so does its expiry job.
    await deps.boss.send(
      QUEUES.expireHold,
      { orderId: created!.id },
      { startAfter: expiresAt, singletonKey: created!.id, db: fromDrizzle(tx, sql) },
    );
    return created!;
  });

  // Seats both released and re-held in the same call are reported once, as held.
  const heldIds = new Set(seatIds);
  deps.realtime.seatsChanged(eventId, [
    ...released.filter((s) => !heldIds.has(s.id)),
    ...seatIds.map((id) => ({ id, status: "held" as const })),
  ]);
  return order;
}

async function endPendingOrder(
  deps: Deps,
  orderId: string,
  status: Extract<OrderStatus, "cancelled" | "expired" | "failed">,
  opts: { userId?: string; onlyIfExpired?: boolean } = {},
): Promise<Released | null> {
  const result = await deps.db.transaction(async (tx) => {
    const order = await lockOrder(tx, orderId, opts.userId);
    if (!order) {
      if (opts.userId) throw notFound("Order");
      return null;
    }
    if (order.status !== "pending") return null;
    if (opts.onlyIfExpired && order.expiresAt > deps.now()) return null;
    await tx.update(orders).set({ status }).where(eq(orders.id, orderId));
    return { eventId: order.eventId, seats: await releaseSeats(tx, orderId) };
  });
  if (result?.seats.length) deps.realtime.seatsChanged(result.eventId, result.seats);
  return result;
}

export const cancelHold = (deps: Deps, userId: string, orderId: string) =>
  endPendingOrder(deps, orderId, "cancelled", { userId });

/** Job handler: releases a hold whose time ran out. Safe to run more than once. */
export const expireHold = (deps: Deps, orderId: string) =>
  endPendingOrder(deps, orderId, "expired", { onlyIfExpired: true });

export async function markPaymentFailed(deps: Deps, orderId: string) {
  return endPendingOrder(deps, orderId, "failed");
}

export type SettleResult = "paid" | "already_settled" | "expired_refunded" | "unknown_order";

/**
 * Called from the payment webhook. Turns a pending hold into sold seats and tickets,
 * or refunds the payment when the hold already expired.
 */
export async function settlePayment(
  deps: Deps,
  tx: Tx,
  sessionId: string,
): Promise<{ result: SettleResult; released?: Released; sold?: Released }> {
  const [order] = await tx.select().from(orders).where(eq(orders.paymentSessionId, sessionId)).for("update");
  if (!order) return { result: "unknown_order" };
  if (order.status === "paid") return { result: "already_settled" };

  const now = deps.now();
  if (order.status !== "pending" || order.expiresAt <= now) {
    let released: Released | undefined;
    if (order.status === "pending") {
      await tx.update(orders).set({ status: "expired" }).where(eq(orders.id, order.id));
      released = { eventId: order.eventId, seats: await releaseSeats(tx, order.id) };
    }
    await tx
      .insert(emails)
      .values({
        userId: order.userId,
        subject: "Your payment was refunded",
        body: "Your seats were released before the payment reached us, so we refunded you in full. Please pick your seats again.",
        dedupeKey: `refund:${order.id}`,
      })
      .onConflictDoNothing();
    return { result: "expired_refunded", released };
  }

  const sold = await tx
    .update(seats)
    .set({ status: "sold" })
    .where(and(eq(seats.orderId, order.id), eq(seats.status, "held")))
    .returning({ id: seats.id });
  await tx.update(orders).set({ status: "paid", paidAt: now }).where(eq(orders.id, order.id));
  await tx.insert(tickets).values(sold.map((s) => ({ orderId: order.id, seatId: s.id, code: ticketCode() })));
  await deps.boss.send(
    QUEUES.issueTickets,
    { orderId: order.id },
    { singletonKey: order.id, db: fromDrizzle(tx, sql) },
  );

  return {
    result: "paid",
    sold: { eventId: order.eventId, seats: sold.map((s) => ({ id: s.id, status: "sold" as const })) },
  };
}
