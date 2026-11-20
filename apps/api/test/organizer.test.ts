import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { availableSeats, client, createHarness, firstEvent, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

async function buyTicket() {
  const event = await firstEvent(h);
  const [seat] = await availableSeats(h, event.slug, 1);
  const c = client(h.app);
  await c.login("ali@tathkara.app");
  const order = (await c.post(`/api/events/${event.id}/holds`, { seatIds: [seat!.id] })).json();
  const { sessionId } = (await c.post(`/api/orders/${order.id}/checkout`)).json();
  await c.post(`/api/mock-pay/sessions/${sessionId}/complete`, { outcome: "succeeded" });
  const [ticket] = (await c.get("/api/tickets")).json();
  return { event, ticket, customer: c };
}

describe("organizer", () => {
  it("checks a ticket in once, and refuses it the second time", async () => {
    const { ticket } = await buyTicket();
    const nora = client(h.app);
    await nora.login("nora@tathkara.app");
    const first = await nora.post("/api/organizer/check-in", { code: ticket.code.toLowerCase() });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ holder: "Ali Hassan", row: ticket.row, number: ticket.number });
    const again = await nora.post("/api/organizer/check-in", { code: ticket.code });
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe("already_checked_in");
  });

  it("only lets the event's organizer scan, and hides tickets from others", async () => {
    const { ticket, customer } = await buyTicket();
    expect((await customer.post("/api/organizer/check-in", { code: ticket.code })).statusCode).toBe(403);
    const unknown = client(h.app);
    await unknown.login("nora@tathkara.app");
    expect((await unknown.post("/api/organizer/check-in", { code: "TK-NOPE-NOPE-NOPE" })).statusCode).toBe(404);
  });

  it("reports sales that add up", async () => {
    const { event } = await buyTicket();
    const nora = client(h.app);
    await nora.login("nora@tathkara.app");
    const stats = (await nora.get(`/api/organizer/events/${event.id}/stats`)).json();
    const detail = (await nora.get(`/api/events/${event.slug}`)).json();
    expect(stats.sold + stats.held + stats.available).toBe(detail.totalSeats);
    expect(stats.salesByTier.reduce((s: number, t: { revenue: number }) => s + t.revenue, 0)).toBe(stats.revenue);
    expect(stats.checkedIn).toBeGreaterThanOrEqual(0);
  });

  it("documents the API with OpenAPI", async () => {
    const res = await h.app.inject({ method: "GET", url: "/api/docs/json" });
    expect(res.statusCode).toBe(200);
    const spec = res.json();
    expect(spec.openapi).toMatch(/^3\./);
    expect(Object.keys(spec.paths)).toEqual(
      expect.arrayContaining(["/api/events/{id}/holds", "/api/webhooks/payments", "/api/auth/refresh"]),
    );
  });
});
