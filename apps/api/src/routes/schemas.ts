import { z } from "zod";
import { ORDER_STATUSES, ROLES, SEAT_STATUSES } from "@tathkara/shared";

/** Response schemas: they drive serialization (no accidental field leaks) and the OpenAPI docs. */

export const UserSchema = z.object({ id: z.uuid(), name: z.string(), email: z.string(), role: z.enum(ROLES) });

export const EventSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  venue: z.string(),
  city: z.string(),
  startsAt: z.string(),
  category: z.string(),
  accent: z.string(),
  fromPrice: z.number().int(),
  seatsLeft: z.number().int(),
  totalSeats: z.number().int(),
});

export const SeatSchema = z.object({
  id: z.uuid(),
  section: z.string(),
  row: z.string(),
  number: z.number().int(),
  tier: z.string(),
  price: z.number().int(),
  status: z.enum(SEAT_STATUSES),
  mine: z.boolean(),
});

export const EventDetailSchema = EventSummarySchema.extend({ description: z.string(), seats: z.array(SeatSchema) });

export const OrderSchema = z.object({
  id: z.uuid(),
  eventId: z.uuid(),
  eventTitle: z.string(),
  status: z.enum(ORDER_STATUSES),
  total: z.number().int(),
  expiresAt: z.string(),
  createdAt: z.string(),
  seats: z.array(SeatSchema.pick({ id: true, section: true, row: true, number: true, tier: true, price: true })),
});

export const TicketSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  eventTitle: z.string(),
  venue: z.string(),
  startsAt: z.string(),
  section: z.string(),
  row: z.string(),
  number: z.number().int(),
  tier: z.string(),
  checkedInAt: z.string().nullable(),
});

export const ErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string(), details: z.unknown().optional() }),
});

export const IdParams = z.object({ id: z.uuid() });
