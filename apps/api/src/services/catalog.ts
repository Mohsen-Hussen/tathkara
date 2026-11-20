import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { EventDetail, EventSummary, Order } from "@tathkara/shared";
import type { Deps } from "../context.js";
import { events, orderSeats, orders, seats } from "../db/schema.js";
import { notFound } from "../lib/errors.js";

const summaryColumns = {
  id: events.id,
  slug: events.slug,
  title: events.title,
  venue: events.venue,
  city: events.city,
  startsAt: events.startsAt,
  category: events.category,
  accent: events.accent,
  description: events.description,
  organizerId: events.organizerId,
  fromPrice: sql<number>`min(${seats.price}) filter (where ${seats.status} = 'available')::int`,
  seatsLeft: sql<number>`count(*) filter (where ${seats.status} = 'available')::int`,
  totalSeats: sql<number>`count(${seats.id})::int`,
};

type SummaryRow = { [K in keyof typeof summaryColumns]: unknown } & {
  startsAt: Date;
  fromPrice: number | null;
};

function toSummary(r: SummaryRow): EventSummary {
  return {
    id: r.id as string,
    slug: r.slug as string,
    title: r.title as string,
    venue: r.venue as string,
    city: r.city as string,
    startsAt: r.startsAt.toISOString(),
    category: r.category as string,
    accent: r.accent as string,
    fromPrice: r.fromPrice ?? 0,
    seatsLeft: r.seatsLeft as number,
    totalSeats: r.totalSeats as number,
  };
}

function summaries(deps: Deps) {
  return deps.db.select(summaryColumns).from(events).leftJoin(seats, eq(seats.eventId, events.id)).groupBy(events.id);
}

export async function listEvents(deps: Deps) {
  const rows = await summaries(deps).where(gt(events.startsAt, deps.now())).orderBy(asc(events.startsAt));
  return rows.map((r) => toSummary(r as SummaryRow));
}

export async function listOrganizerEvents(deps: Deps, organizerId: string) {
  const rows = await summaries(deps).where(eq(events.organizerId, organizerId)).orderBy(asc(events.startsAt));
  return rows.map((r) => toSummary(r as SummaryRow));
}

export async function getEvent(deps: Deps, slugOrId: string, userId: string | null): Promise<EventDetail> {
  const isUuid = /^[0-9a-f-]{36}$/i.test(slugOrId);
  const [row] = await summaries(deps).where(isUuid ? eq(events.id, slugOrId) : eq(events.slug, slugOrId));
  if (!row) throw notFound("Event");
  const seatRows = await deps.db
    .select({
      id: seats.id,
      section: seats.section,
      row: seats.row,
      number: seats.number,
      tier: seats.tier,
      price: seats.price,
      status: seats.status,
      ownerId: orders.userId,
    })
    .from(seats)
    .leftJoin(orders, and(eq(orders.id, seats.orderId), eq(orders.status, "pending")))
    .where(eq(seats.eventId, row.id as string))
    .orderBy(asc(seats.section), asc(seats.row), asc(seats.number));
  return {
    ...toSummary(row as SummaryRow),
    description: row.description as string,
    // Never reveal who holds a seat — only whether it's yours.
    seats: seatRows.map(({ ownerId, ...s }) => ({ ...s, mine: userId !== null && ownerId === userId })),
  };
}

export async function getOrder(deps: Deps, userId: string, orderId: string): Promise<Order> {
  const [order] = await deps.db
    .select({ order: orders, title: events.title })
    .from(orders)
    .innerJoin(events, eq(events.id, orders.eventId))
    .where(and(eq(orders.id, orderId), eq(orders.userId, userId)));
  if (!order) throw notFound("Order");
  const lines = await deps.db
    .select({
      id: seats.id,
      section: seats.section,
      row: seats.row,
      number: seats.number,
      tier: seats.tier,
      price: orderSeats.price,
    })
    .from(orderSeats)
    .innerJoin(seats, eq(seats.id, orderSeats.seatId))
    .where(eq(orderSeats.orderId, orderId))
    .orderBy(asc(seats.row), asc(seats.number));
  const o = order.order;
  return {
    id: o.id,
    eventId: o.eventId,
    eventTitle: order.title,
    status: o.status,
    total: o.total,
    expiresAt: o.expiresAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    seats: lines,
  };
}

export async function listOrders(deps: Deps, userId: string) {
  const rows = await deps.db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.userId, userId))
    .orderBy(desc(orders.createdAt))
    .limit(30);
  return Promise.all(rows.map((r) => getOrder(deps, userId, r.id)));
}
