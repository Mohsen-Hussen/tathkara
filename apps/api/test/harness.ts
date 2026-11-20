import { randomUUID } from "node:crypto";
import pg from "pg";
import { PgBoss } from "pg-boss";
import { inject } from "vitest";
import type { SeatChange } from "@tathkara/shared";
import { buildApp, type App } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { Deps } from "../src/context.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";
import { seed } from "../src/db/seed.js";
import { createQueues } from "../src/jobs/workers.js";

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** A fresh database, migrated and seeded, plus an app instance with a controllable clock. */
export async function createHarness() {
  const adminUrl = inject("adminUrl");
  const name = `t_${randomUUID().replace(/-/g, "")}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`create database ${name}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${name}`;
  const databaseUrl = url.toString();

  let current = new Date("2026-11-20T12:00:00Z");
  const clock = {
    now: () => new Date(current),
    advance(ms: number) {
      current = new Date(current.getTime() + ms);
    },
  };

  const { db, pool } = createDb(databaseUrl);
  await runMigrations(db);
  const boss = new PgBoss({ connectionString: databaseUrl, max: 2 });
  boss.on("error", () => {});
  await boss.start();

  const changes: { eventId: string; seats: SeatChange[] }[] = [];
  let app: App | null = null;
  const deps: Deps = {
    config: { ...loadConfig({ NODE_ENV: "test", LOG_LEVEL: "silent" }), databaseUrl },
    db,
    boss,
    now: clock.now,
    realtime: { seatsChanged: (eventId, seats) => changes.push({ eventId, seats }) },
    deliverWebhook: async (body, signature) => {
      const res = await app!.inject({
        method: "POST",
        url: "/api/webhooks/payments",
        headers: { "content-type": "application/json", "x-tathkara-signature": signature },
        payload: body,
      });
      if (res.statusCode !== 200) throw new Error(`webhook ${res.statusCode}: ${res.body}`);
    },
  };
  await createQueues(deps);
  await seed(deps);
  app = await buildApp(deps);
  await app.ready();

  return {
    app,
    deps,
    db,
    clock,
    changes,
    databaseUrl,
    async close() {
      await app!.close();
      await boss.stop({ graceful: false, close: true });
      await pool.end();
    },
  };
}

/** Minimal cookie jar around app.inject, so tests behave like a browser session. */
export function client(app: App) {
  const jar = new Map<string, string>();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  async function request(method: "GET" | "POST" | "DELETE", url: string, body?: unknown) {
    const res = await app.inject({
      method,
      url,
      headers: { cookie: cookieHeader(), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    for (const c of res.cookies) {
      if (
        c.value === "" ||
        (c.maxAge !== undefined && c.maxAge <= 0) ||
        (c.expires && c.expires.getTime() < Date.now())
      )
        jar.delete(c.name);
      else jar.set(c.name, c.value);
    }
    return res;
  }
  return {
    jar,
    get: (url: string) => request("GET", url),
    post: (url: string, body?: unknown) => request("POST", url, body ?? {}),
    del: (url: string) => request("DELETE", url),
    async login(email: string, password = "demo1234") {
      const res = await request("POST", "/api/auth/login", { email, password });
      if (res.statusCode !== 200) throw new Error(`login failed: ${res.body}`);
      return res.json().user as { id: string; role: string };
    },
  };
}

export async function firstEvent(h: Harness) {
  const res = await h.app.inject({ method: "GET", url: "/api/events" });
  return res.json()[0] as { id: string; slug: string };
}

export async function availableSeats(h: Harness, slug: string, n: number) {
  const res = await h.app.inject({ method: "GET", url: `/api/events/${slug}` });
  const seats = (res.json().seats as { id: string; status: string; price: number }[]).filter(
    (s) => s.status === "available",
  );
  return seats.slice(0, n);
}
