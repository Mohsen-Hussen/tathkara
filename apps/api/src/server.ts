import { PgBoss } from "pg-boss";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { seedIfEmpty } from "./db/seed.js";
import { buildApp } from "./app.js";
import { createRealtime } from "./realtime/socket.js";
import { createQueues, startWorkers } from "./jobs/workers.js";
import type { Deps } from "./context.js";

const config = loadConfig();
const { db, pool } = createDb(config.databaseUrl);
await runMigrations(db);

const boss = new PgBoss(config.databaseUrl);
const realtime = createRealtime();
const internalWebhookUrl = `http://127.0.0.1:${config.port}/api/webhooks/payments`;

const deps: Deps = {
  config,
  db,
  boss,
  realtime,
  now: () => new Date(),
  // The mock provider posts to us over HTTP like a real one would.
  deliverWebhook: async (body, signature) => {
    const res = await fetch(internalWebhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json", "x-tathkara-signature": signature },
      body,
    });
    if (!res.ok) throw new Error(`Webhook delivery failed with ${res.status}`);
  },
};

const app = await buildApp(deps);
boss.on("error", (err) => app.log.error({ err }, "pg-boss error"));
await boss.start();
await createQueues(deps);
if (config.seedOnStart) await seedIfEmpty(deps);
await startWorkers(deps);

realtime.attach(app.server);
await app.listen({ port: config.port, host: config.host });

let closing = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, "shutting down");
    await app.close();
    await realtime.close();
    await boss.stop({ graceful: true });
    await pool.end();
    process.exit(0);
  });
}
