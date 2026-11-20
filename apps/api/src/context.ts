import type { PgBoss } from "pg-boss";
import type { SeatChange } from "@tathkara/shared";
import type { Config } from "./config.js";
import type { Db } from "./db/client.js";

export interface Realtime {
  seatsChanged(eventId: string, seats: SeatChange[]): void;
}

/** Delivers a signed webhook to the API, the way a payment provider would. */
export type WebhookDeliverer = (body: string, signature: string) => Promise<void>;

/** Everything a route or job needs, passed explicitly so tests can swap any piece. */
export interface Deps {
  config: Config;
  db: Db;
  boss: PgBoss;
  realtime: Realtime;
  deliverWebhook: WebhookDeliverer;
  now: () => Date;
}
