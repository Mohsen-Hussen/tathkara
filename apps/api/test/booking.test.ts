import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { HOLD_MINUTES } from "@tathkara/shared";
import { orders, seats, users } from "../src/db/schema.js";
import { hashPassword } from "../src/lib/password.js";
import { signAccessToken } from "../src/services/auth.js";
import { expireHold } from "../src/services/booking.js";
import { availableSeats, client, createHarness, firstEvent, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

/** Creates signed-in shoppers quickly (one password hash, tokens minted directly). */
async function shoppers(n: number) {
  const passwordHash = await hashPassword("irrelevant1");
  const rows = await h.db
    .insert(users)
    .values(
      Array.from({ length: n }, (_, i) => ({
        name: `Shopper ${i}`,
        email: `shopper-${Date.now()}-${i}@test.dev`,
        passwordHash,
      })),
    )
    .returning();
  return Promise.all(
    rows.map(async (u) => {
      const token = await signAccessToken(h.deps, { id: u.id, name: u.name, email: u.email, role: u.role });
      return (url: string, body: unknown) =>
        h.app.inject({
          method: "POST",
          url,
          headers: { cookie: `tk_at=${token}`, "content-type": "application/json" },
          payload: JSON.stringify(body),
        });
    }),
  );
}

describe("seat holds", () => {
  it("holds seats for 10 minutes and pushes the change to viewers", async () => {
    const event = await firstEvent(h);
    const picked = await availableSeats(h, event.slug, 2);
    const c = client(h.app);
    await c.login("ali@tathkara.app");
    h.changes.length = 0;

    const res = await c.post(`/api/events/${event.id}/holds`, { seatIds: picked.map((s) => s.id) });
    expect(res.statusCode).toBe(201);
    const order = res.json();
    expect(order.status).toBe("pending");
    expect(order.total).toBe(picked.reduce((s, x) => s + x.price, 0));
    expect(new Date(order.expiresAt).getTime() - h.clock.now().getTime()).toBe(HOLD_MINUTES * 60_000);
    expect(h.changes).toEqual([{ eventId: event.id, seats: picked.map((s) => ({ id: s.id, status: "held" })) }]);

    // The owner sees the seats as theirs; everyone else just sees "held".
    const mine = (await c.get(`/api/events/${event.slug}`)).json().seats.filter((s: { mine: boolean }) => s.mine);
    expect(mine).toHaveLength(2);
    const anon = (await h.app.inject({ method: "GET", url: `/api/events/${event.slug}` })).json();
    expect(anon.seats.filter((s: { mine: boolean }) => s.mine)).toHaveLength(0);
  });

  it("returns 409 with the taken seat ids", async () => {
    const event = await firstEvent(h);
    const [a, b] = await availableSeats(h, event.slug, 2);
    const ali = client(h.app);
    await ali.login("ali@tathkara.app");
    await ali.post(`/api/events/${event.id}/holds`, { seatIds: [a!.id] });

    const sara = client(h.app);
    await sara.login("sara@tathkara.app");
    const res = await sara.post(`/api/events/${event.id}/holds`, { seatIds: [b!.id, a!.id] });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toMatchObject({ code: "seats_unavailable", details: { seatIds: [a!.id] } });
    // Nothing was partially held.
    const [seatB] = await h.db.select().from(seats).where(eq(seats.id, b!.id));
    expect(seatB!.status).toBe("available");
  });

  it("lets exactly one of 50 simultaneous buyers get the same seat", async () => {
    const event = await firstEvent(h);
    const [seat] = await availableSeats(h, event.slug, 1);
    const buyers = await shoppers(50);
    const results = await Promise.all(
      buyers.map((post) => post(`/api/events/${event.id}/holds`, { seatIds: [seat!.id] })),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(49);
    const [{ n }] = (await h.db
      .select({ n: sql<number>`count(*)::int` })
      .from(orders)
      .where(eq(orders.total, seat!.price))) as [{ n: number }];
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it("doesn't deadlock when buyers lock overlapping seats in opposite order", async () => {
    const event = await firstEvent(h);
    const pool = await availableSeats(h, event.slug, 6);
    const buyers = await shoppers(30);
    const results = await Promise.all(
      buyers.map((post, i) => {
        const ids = pool.map((s) => s.id);
        return post(`/api/events/${event.id}/holds`, { seatIds: i % 2 ? ids : [...ids].reverse() });
      }),
    );
    const codes = results.map((r) => r.statusCode);
    expect(codes.filter((c) => c === 201)).toHaveLength(1);
    expect(codes.every((c) => c === 201 || c === 409)).toBe(true);
  });

  it("replaces your previous hold for the same event", async () => {
    const event = await firstEvent(h);
    const [a, b] = await availableSeats(h, event.slug, 2);
    const c = client(h.app);
    await c.login("sara@tathkara.app");
    const first = (await c.post(`/api/events/${event.id}/holds`, { seatIds: [a!.id] })).json();
    const second = await c.post(`/api/events/${event.id}/holds`, { seatIds: [b!.id] });
    expect(second.statusCode).toBe(201);
    expect((await c.get(`/api/orders/${first.id}`)).json().status).toBe("cancelled");
    const [seatA] = await h.db.select().from(seats).where(eq(seats.id, a!.id));
    expect(seatA).toMatchObject({ status: "available", orderId: null });
  });

  it("schedules the expiry job in the same transaction as the hold", async () => {
    const event = await firstEvent(h);
    const [a] = await availableSeats(h, event.slug, 1);
    const c = client(h.app);
    await c.login("ali@tathkara.app");
    const order = (await c.post(`/api/events/${event.id}/holds`, { seatIds: [a!.id] })).json();
    const jobs = await h.db.execute<{ start_after: Date }>(
      sql`select start_after from pgboss.job where name = 'hold.expire' and singleton_key = ${order.id}`,
    );
    expect(jobs.rows).toHaveLength(1);
    expect(new Date(jobs.rows[0]!.start_after).toISOString()).toBe(order.expiresAt);
  });

  it("releases seats when the hold expires, and only then", async () => {
    const event = await firstEvent(h);
    const [a] = await availableSeats(h, event.slug, 1);
    const c = client(h.app);
    await c.login("ali@tathkara.app");
    const order = (await c.post(`/api/events/${event.id}/holds`, { seatIds: [a!.id] })).json();

    expect(await expireHold(h.deps, order.id)).toBeNull(); // too early: nothing happens
    h.clock.advance(HOLD_MINUTES * 60_000 + 1_000);
    const result = await expireHold(h.deps, order.id);
    expect(result?.seats).toEqual([{ id: a!.id, status: "available" }]);
    expect((await c.get(`/api/orders/${order.id}`)).json().status).toBe("expired");
    expect(await expireHold(h.deps, order.id)).toBeNull(); // idempotent
  });

  it("lets you release your hold, but not someone else's", async () => {
    const event = await firstEvent(h);
    const [a] = await availableSeats(h, event.slug, 1);
    const ali = client(h.app);
    await ali.login("ali@tathkara.app");
    const order = (await ali.post(`/api/events/${event.id}/holds`, { seatIds: [a!.id] })).json();
    const sara = client(h.app);
    await sara.login("sara@tathkara.app");
    expect((await sara.del(`/api/orders/${order.id}`)).statusCode).toBe(404);
    expect((await ali.del(`/api/orders/${order.id}`)).statusCode).toBe(204);
    expect((await ali.get(`/api/orders/${order.id}`)).json().status).toBe("cancelled");
  });

  it("validates the request", async () => {
    const event = await firstEvent(h);
    const c = client(h.app);
    expect((await c.post(`/api/events/${event.id}/holds`, { seatIds: [] })).statusCode).toBe(401);
    await c.login("ali@tathkara.app");
    expect((await c.post(`/api/events/${event.id}/holds`, { seatIds: [] })).statusCode).toBe(400);
    const nine = Array.from({ length: 9 }, () => crypto.randomUUID());
    expect((await c.post(`/api/events/${event.id}/holds`, { seatIds: nine })).statusCode).toBe(400);
    expect((await c.post(`/api/events/${event.id}/holds`, { seatIds: [crypto.randomUUID()] })).statusCode).toBe(404);
  });
});
