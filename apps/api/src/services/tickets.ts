import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import type { Ticket } from "@tathkara/shared";
import type { Deps } from "../context.js";
import { emails, events, orders, seats, tickets, users } from "../db/schema.js";
import { conflict, notFound } from "../lib/errors.js";

const ticketColumns = {
  id: tickets.id,
  code: tickets.code,
  checkedInAt: tickets.checkedInAt,
  eventTitle: events.title,
  venue: events.venue,
  city: events.city,
  startsAt: events.startsAt,
  section: seats.section,
  row: seats.row,
  number: seats.number,
  tier: seats.tier,
};

type TicketRow = {
  id: string;
  code: string;
  checkedInAt: Date | null;
  eventTitle: string;
  venue: string;
  city: string;
  startsAt: Date;
  section: string;
  row: string;
  number: number;
  tier: string;
};

function toTicket(r: TicketRow): Ticket {
  return {
    id: r.id,
    code: r.code,
    eventTitle: r.eventTitle,
    venue: `${r.venue}, ${r.city}`,
    startsAt: r.startsAt.toISOString(),
    section: r.section,
    row: r.row,
    number: r.number,
    tier: r.tier,
    checkedInAt: r.checkedInAt?.toISOString() ?? null,
  };
}

function ticketQuery(deps: Deps) {
  return deps.db
    .select(ticketColumns)
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .innerJoin(seats, eq(seats.id, tickets.seatId))
    .innerJoin(events, eq(events.id, orders.eventId));
}

export async function listTickets(deps: Deps, userId: string) {
  const rows = await ticketQuery(deps)
    .where(eq(orders.userId, userId))
    .orderBy(asc(events.startsAt), asc(seats.section), asc(seats.row), asc(seats.number));
  return rows.map((r) => toTicket(r as TicketRow));
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Riyadh",
});

/** One A6 page per ticket, with a QR code the door staff scan. */
export async function renderTicketsPdf(list: Ticket[]): Promise<Buffer> {
  const doc = new PDFDocument({ size: "A6", margin: 24, info: { Title: "Tathkara tickets" } });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((resolve) => doc.on("end", () => resolve(Buffer.concat(chunks))));

  for (const [i, t] of list.entries()) {
    if (i > 0) doc.addPage();
    const qr = await QRCode.toBuffer(t.code, { margin: 1, width: 300, errorCorrectionLevel: "M" });
    const w = doc.page.width;
    doc.rect(0, 0, w, 54).fill("#0f172a");
    doc.fill("#ffffff").font("Helvetica-Bold").fontSize(16).text("tathkara", 24, 18);
    doc
      .fill("#94a3b8")
      .font("Helvetica")
      .fontSize(8)
      .text(`Ticket ${i + 1} of ${list.length}`, 24, 22, { align: "right", width: w - 48 });
    doc
      .fill("#0f172a")
      .font("Helvetica-Bold")
      .fontSize(13)
      .text(t.eventTitle, 24, 70, { width: w - 48 });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fill("#475569")
      .text(DATE.format(new Date(t.startsAt)), { width: w - 48 })
      .text(t.venue);
    const y = doc.y + 10;
    const cols = [
      ["Section", t.section],
      ["Row", t.row],
      ["Seat", String(t.number)],
      ["Tier", t.tier],
    ] as const;
    cols.forEach(([label, value], c) => {
      const x = 24 + c * ((w - 48) / 4);
      doc.fontSize(7).fill("#64748b").text(label.toUpperCase(), x, y);
      doc
        .font("Helvetica-Bold")
        .fontSize(11)
        .fill("#0f172a")
        .text(value, x, y + 10);
      doc.font("Helvetica");
    });
    const size = 130;
    doc.image(qr, (w - size) / 2, y + 36, { width: size });
    doc
      .font("Courier-Bold")
      .fontSize(10)
      .fill("#0f172a")
      .text(t.code, 24, y + 36 + size + 6, { width: w - 48, align: "center" });
  }
  doc.end();
  return done;
}

/** Job handler: emails the tickets once. Retries are safe thanks to the dedupe key. */
export async function issueTickets(deps: Deps, orderId: string) {
  const [order] = await deps.db
    .select({ userId: orders.userId, name: users.name, status: orders.status })
    .from(orders)
    .innerJoin(users, eq(users.id, orders.userId))
    .where(eq(orders.id, orderId));
  if (!order || order.status !== "paid") return { sent: false };
  const rows = await ticketQuery(deps).where(eq(orders.id, orderId)).orderBy(asc(seats.row), asc(seats.number));
  const list = rows.map((r) => toTicket(r as TicketRow));
  if (!list.length) return { sent: false };

  const pdf = await renderTicketsPdf(list);
  const seatsText = list.map((t) => `• ${t.section}, row ${t.row}, seat ${t.number} — ${t.code}`).join("\n");
  const inserted = await deps.db
    .insert(emails)
    .values({
      userId: order.userId,
      subject: `Your tickets for ${list[0]!.eventTitle}`,
      body: `Hi ${order.name.split(" ")[0]},\n\nYou're going! Your tickets are attached. Show the QR code at the entrance.\n\n${seatsText}\n\nEnjoy the event,\nTathkara`,
      attachmentName: "tickets.pdf",
      attachment: pdf,
      dedupeKey: `tickets:${orderId}`,
    })
    .onConflictDoNothing()
    .returning({ id: emails.id });
  return { sent: inserted.length > 0 };
}

export async function listInbox(deps: Deps, userId: string) {
  return deps.db
    .select({
      id: emails.id,
      subject: emails.subject,
      body: emails.body,
      createdAt: emails.createdAt,
      attachmentName: emails.attachmentName,
    })
    .from(emails)
    .where(eq(emails.userId, userId))
    .orderBy(desc(emails.createdAt));
}

export async function getAttachment(deps: Deps, userId: string, emailId: string) {
  const [row] = await deps.db
    .select({ name: emails.attachmentName, data: emails.attachment })
    .from(emails)
    .where(and(eq(emails.id, emailId), eq(emails.userId, userId)));
  if (!row?.data || !row.name) throw notFound("Attachment");
  return row;
}

/**
 * Door check-in. The row lock means two scanners at two gates can't both admit the
 * same ticket. Tickets for other organizers' events look like they don't exist.
 */
export async function checkIn(deps: Deps, organizerId: string, code: string) {
  return deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select({
        id: tickets.id,
        checkedInAt: tickets.checkedInAt,
        organizerId: events.organizerId,
        eventTitle: events.title,
        section: seats.section,
        row: seats.row,
        number: seats.number,
        tier: seats.tier,
        holder: users.name,
      })
      .from(tickets)
      .innerJoin(orders, eq(orders.id, tickets.orderId))
      .innerJoin(events, eq(events.id, orders.eventId))
      .innerJoin(seats, eq(seats.id, tickets.seatId))
      .innerJoin(users, eq(users.id, orders.userId))
      .where(eq(tickets.code, code.trim().toUpperCase()))
      .for("update", { of: tickets });
    if (!row || row.organizerId !== organizerId) throw notFound("Ticket");
    if (row.checkedInAt) {
      throw conflict("already_checked_in", `This ticket was already used at ${row.checkedInAt.toISOString()}.`, {
        checkedInAt: row.checkedInAt.toISOString(),
      });
    }
    const now = deps.now();
    await tx.update(tickets).set({ checkedInAt: now }).where(eq(tickets.id, row.id));
    return { ...row, checkedInAt: now.toISOString(), organizerId: undefined };
  });
}

export async function eventStats(deps: Deps, organizerId: string, eventId: string) {
  const [event] = await deps.db
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), eq(events.organizerId, organizerId)));
  if (!event) throw notFound("Event");
  const [seatCounts] = await deps.db
    .select({
      sold: sql<number>`count(*) filter (where ${seats.status} = 'sold')::int`,
      held: sql<number>`count(*) filter (where ${seats.status} = 'held')::int`,
      available: sql<number>`count(*) filter (where ${seats.status} = 'available')::int`,
    })
    .from(seats)
    .where(eq(seats.eventId, eventId));
  const byStatus = await deps.db
    .select({
      status: orders.status,
      count: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${orders.total}),0)::int`,
    })
    .from(orders)
    .where(eq(orders.eventId, eventId))
    .groupBy(orders.status);
  const byTier = await deps.db
    .select({ tier: seats.tier, sold: sql<number>`count(*)::int`, revenue: sql<number>`sum(${seats.price})::int` })
    .from(seats)
    .where(and(eq(seats.eventId, eventId), eq(seats.status, "sold")))
    .groupBy(seats.tier)
    .orderBy(desc(sql`sum(${seats.price})`));
  const [checked] = await deps.db
    .select({ n: sql<number>`count(*)::int` })
    .from(tickets)
    .innerJoin(orders, eq(orders.id, tickets.orderId))
    .where(and(eq(orders.eventId, eventId), sql`${tickets.checkedInAt} is not null`));
  return {
    eventId,
    title: event.title,
    revenue: byStatus.find((s) => s.status === "paid")?.revenue ?? 0,
    sold: seatCounts!.sold,
    held: seatCounts!.held,
    available: seatCounts!.available,
    checkedIn: checked!.n,
    ordersByStatus: Object.fromEntries(byStatus.map((s) => [s.status, s.count])),
    salesByTier: byTier,
  };
}
