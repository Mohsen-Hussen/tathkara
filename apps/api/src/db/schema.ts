import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { ORDER_STATUSES, ROLES, SEAT_STATUSES } from "@tathkara/shared";

const bytea = customType<{ data: Buffer }>({ dataType: () => "bytea" });
const ts = (name: string) => timestamp(name, { withTimezone: true });

export const roleEnum = pgEnum("role", ROLES);
export const seatStatusEnum = pgEnum("seat_status", SEAT_STATUSES);
export const orderStatusEnum = pgEnum("order_status", ORDER_STATUSES);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: roleEnum("role").notNull().default("customer"),
  createdAt: ts("created_at").notNull().defaultNow(),
});

/**
 * Rotating refresh tokens. Each login starts a `family`; every refresh replaces the
 * token with a new one in the same family. Presenting a token that was already used
 * means it leaked, so the whole family is revoked.
 */
export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    familyId: uuid("family_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    revokedAt: ts("revoked_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("refresh_tokens_family_idx").on(t.familyId)],
);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizerId: uuid("organizer_id")
    .notNull()
    .references(() => users.id),
  slug: text("slug").notNull().unique(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  venue: text("venue").notNull(),
  city: text("city").notNull(),
  category: text("category").notNull(),
  accent: text("accent").notNull(),
  startsAt: ts("starts_at").notNull(),
});

export const seats = pgTable(
  "seats",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    row: text("row").notNull(),
    number: integer("number").notNull(),
    tier: text("tier").notNull(),
    /** Price in halalas. */
    price: integer("price").notNull(),
    status: seatStatusEnum("status").notNull().default("available"),
    /** The pending or paid order that owns the seat, if any. */
    orderId: uuid("order_id"),
  },
  (t) => [
    uniqueIndex("seats_position_idx").on(t.eventId, t.section, t.row, t.number),
    index("seats_event_status_idx").on(t.eventId, t.status),
    // A seat is owned by an order exactly when it isn't available.
    check("seats_owner_matches_status", sql`(${t.status} = 'available') = (${t.orderId} is null)`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id),
    status: orderStatusEnum("status").notNull().default("pending"),
    total: integer("total").notNull(),
    expiresAt: ts("expires_at").notNull(),
    paymentSessionId: text("payment_session_id").unique(),
    paidAt: ts("paid_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("orders_user_idx").on(t.userId, t.createdAt), index("orders_event_idx").on(t.eventId, t.status)],
);

/** The seats an order was for, kept after the hold is released (for history). */
export const orderSeats = pgTable(
  "order_seats",
  {
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id),
    price: integer("price").notNull(),
  },
  (t) => [primaryKey({ columns: [t.orderId, t.seatId] })],
);

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    seatId: uuid("seat_id")
      .notNull()
      .references(() => seats.id)
      .unique(),
    code: text("code").notNull().unique(),
    checkedInAt: ts("checked_in_at"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("tickets_order_idx").on(t.orderId)],
);

/** Every webhook delivery we've processed — the primary key makes handling idempotent. */
export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: ts("received_at").notNull().defaultNow(),
});

/** Demo mailbox: outgoing email is stored instead of sent, and shown in the app. */
export const emails = pgTable(
  "emails",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    attachmentName: text("attachment_name"),
    attachment: bytea("attachment"),
    /** Makes background jobs safe to retry: the same email is never stored twice. */
    dedupeKey: text("dedupe_key").unique(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("emails_user_idx").on(t.userId, t.createdAt)],
);
