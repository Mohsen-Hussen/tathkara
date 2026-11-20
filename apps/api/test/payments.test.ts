import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { HOLD_MINUTES } from "@tathkara/shared";
import { emails, seats, tickets } from "../src/db/schema.js";
import { sign } from "../src/services/payments.js";
import { issueTickets } from "../src/services/tickets.js";
import { availableSeats, client, createHarness, firstEvent, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

async function holdAndCheckout(email = "ali@tathkara.app", n = 2) {
  const event = await firstEvent(h);
  const picked = await availableSeats(h, event.slug, n);
  const c = client(h.app);
  await c.login(email);
  const order = (await c.post(`/api/events/${event.id}/holds`, { seatIds: picked.map((s) => s.id) })).json();
  const checkout = await c.post(`/api/orders/${order.id}/checkout`);
  expect(checkout.statusCode).toBe(200);
  return { c, event, order, picked, sessionId: checkout.json().sessionId as string };
}

function webhook(body: object, signature?: string) {
  const raw = JSON.stringify(body);
  const ts = Math.floor(h.clock.now().getTime() / 1000);
  return h.app.inject({
    method: "POST",
    url: "/api/webhooks/payments",
    headers: {
      "content-type": "application/json",
      "x-tathkara-signature": signature ?? sign(h.deps.config.webhookSecret, raw, ts),
    },
    payload: raw,
  });
}

describe("payments", () => {
  it("settles a paid order: seats sold, tickets issued, email job queued", async () => {
    const { c, order, picked, sessionId } = await holdAndCheckout();
    h.changes.length = 0;
    const done = await c.post(`/api/mock-pay/sessions/${sessionId}/complete`, { outcome: "succeeded" });
    expect(done.statusCode).toBe(200);

    expect((await c.get(`/api/orders/${order.id}`)).json().status).toBe("paid");
    const sold = await h.db.select().from(seats).where(eq(seats.orderId, order.id));
    expect(sold.map((s) => s.status)).toEqual(["sold", "sold"]);
    expect(h.changes.at(-1)?.seats.map((s) => s.status)).toEqual(["sold", "sold"]);

    const mine = (await c.get("/api/tickets")).json();
    expect(mine.filter((t: { code: string }) => /^TK-\w{4}-\w{4}-\w{4}$/.test(t.code))).toHaveLength(picked.length);

    const jobs = await h.db.execute(
      sql`select 1 from pgboss.job where name = 'tickets.issue' and singleton_key = ${order.id}`,
    );
    expect(jobs.rows).toHaveLength(1);
  });

  it("emails the tickets as a PDF exactly once, even if the job runs twice", async () => {
    const { c, order, sessionId } = await holdAndCheckout("sara@tathkara.app", 3);
    await c.post(`/api/mock-pay/sessions/${sessionId}/complete`, { outcome: "succeeded" });
    expect(await issueTickets(h.deps, order.id)).toEqual({ sent: true });
    expect(await issueTickets(h.deps, order.id)).toEqual({ sent: false });

    const inbox = (await c.get("/api/inbox")).json();
    const mail = inbox.find((m: { subject: string }) => m.subject.startsWith("Your tickets"));
    expect(mail.body).toMatch(/row \w, seat \d+ — TK-/);
    const pdf = await c.get(mail.attachment.url);
    expect(pdf.headers["content-type"]).toBe("application/pdf");
    expect(pdf.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    // Another user can't download it.
    const other = client(h.app);
    await other.login("ali@tathkara.app");
    expect((await other.get(mail.attachment.url)).statusCode).toBe(404);
  });

  it("ignores a replayed webhook (same event id)", async () => {
    const { order, sessionId } = await holdAndCheckout();
    const event = {
      id: "evt_replay_test",
      type: "payment.succeeded",
      created: 0,
      data: { sessionId, amount: order.total },
    };
    expect((await webhook(event)).json()).toEqual({ received: true, duplicate: false });
    expect((await webhook(event)).json()).toEqual({ received: true, duplicate: true });
    const issued = await h.db.select().from(tickets).where(eq(tickets.orderId, order.id));
    expect(issued).toHaveLength(2);
  });

  it("rejects bad or stale signatures", async () => {
    const { order, sessionId } = await holdAndCheckout();
    const event = { id: "evt_forged", type: "payment.succeeded", created: 0, data: { sessionId, amount: order.total } };
    const forged = await webhook(
      event,
      sign("not-the-secret-123", JSON.stringify(event), Math.floor(h.clock.now().getTime() / 1000)),
    );
    expect(forged.statusCode).toBe(400);
    const stale = await webhook(
      event,
      sign(h.deps.config.webhookSecret, JSON.stringify(event), Math.floor(h.clock.now().getTime() / 1000) - 600),
    );
    expect(stale.statusCode).toBe(400);
    expect((await webhook(event, "garbage")).statusCode).toBe(400);
  });

  it("refunds a payment that arrives after the hold expired", async () => {
    const { c, order, picked, sessionId } = await holdAndCheckout("sara@tathkara.app", 1);
    h.clock.advance(HOLD_MINUTES * 60_000 + 5_000);
    await c.post(`/api/mock-pay/sessions/${sessionId}/complete`, { outcome: "succeeded" });
    expect((await c.get(`/api/orders/${order.id}`)).json().status).toBe("expired");
    const [seat] = await h.db.select().from(seats).where(eq(seats.id, picked[0]!.id));
    expect(seat!.status).toBe("available");
    const refunds = await h.db
      .select()
      .from(emails)
      .where(eq(emails.dedupeKey, `refund:${order.id}`));
    expect(refunds).toHaveLength(1);
  });

  it("releases the seats when the payment fails", async () => {
    const { c, order, picked, sessionId } = await holdAndCheckout();
    await c.post(`/api/mock-pay/sessions/${sessionId}/complete`, { outcome: "failed" });
    expect((await c.get(`/api/orders/${order.id}`)).json().status).toBe("failed");
    const rows = await h.db.select().from(seats).where(eq(seats.id, picked[0]!.id));
    expect(rows[0]!.status).toBe("available");
  });

  it("won't start checkout for someone else's order", async () => {
    const { order } = await holdAndCheckout();
    const other = client(h.app);
    await other.login("sara@tathkara.app");
    expect((await other.post(`/api/orders/${order.id}/checkout`)).statusCode).toBe(404);
  });
});
