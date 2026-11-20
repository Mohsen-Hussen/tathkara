import { z } from "zod";

/** Contracts shared by the API (validation + OpenAPI) and the web app (forms + types). */

export const HOLD_MINUTES = 10;
export const MAX_SEATS_PER_ORDER = 8;

export const SEAT_STATUSES = ["available", "held", "sold"] as const;
export type SeatStatus = (typeof SEAT_STATUSES)[number];

export const ORDER_STATUSES = ["pending", "paid", "expired", "cancelled", "failed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ROLES = ["customer", "organizer"] as const;
export type Role = (typeof ROLES)[number];

export const RegisterInput = z.object({
  name: z.string().trim().min(2, "Enter your name.").max(80),
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: z
    .string()
    .min(8, "Use at least 8 characters.")
    .max(128)
    .regex(/[A-Za-z]/, "Include at least one letter.")
    .regex(/\d/, "Include at least one number."),
});
export type RegisterInput = z.infer<typeof RegisterInput>;

export const LoginInput = z.object({
  email: z.email("Enter a valid email address.").trim().toLowerCase(),
  password: z.string().min(1, "Enter your password.").max(128),
});
export type LoginInput = z.infer<typeof LoginInput>;

export const HoldInput = z.object({
  seatIds: z
    .array(z.uuid())
    .min(1, "Pick at least one seat.")
    .max(MAX_SEATS_PER_ORDER, `You can hold up to ${MAX_SEATS_PER_ORDER} seats.`)
    .refine((ids) => new Set(ids).size === ids.length, "Each seat can only be picked once."),
});
export type HoldInput = z.infer<typeof HoldInput>;

export const CheckInInput = z.object({ code: z.string().trim().min(6).max(64) });
export type CheckInInput = z.infer<typeof CheckInInput>;

export type User = { id: string; name: string; email: string; role: Role };

export type EventSummary = {
  id: string;
  slug: string;
  title: string;
  venue: string;
  city: string;
  startsAt: string;
  category: string;
  accent: string;
  fromPrice: number;
  seatsLeft: number;
  totalSeats: number;
};

export type Seat = {
  id: string;
  section: string;
  row: string;
  number: number;
  tier: string;
  price: number;
  status: SeatStatus;
  /** True when the seat is held by the current user's pending order. */
  mine: boolean;
};

export type EventDetail = EventSummary & { description: string; seats: Seat[] };

export type Order = {
  id: string;
  eventId: string;
  eventTitle: string;
  status: OrderStatus;
  total: number;
  expiresAt: string;
  createdAt: string;
  seats: Pick<Seat, "id" | "section" | "row" | "number" | "tier" | "price">[];
};

export type Ticket = {
  id: string;
  code: string;
  eventTitle: string;
  venue: string;
  startsAt: string;
  section: string;
  row: string;
  number: number;
  tier: string;
  checkedInAt: string | null;
};

export type InboxMessage = {
  id: string;
  subject: string;
  body: string;
  createdAt: string;
  attachment: { name: string; url: string } | null;
};

export type EventStats = {
  eventId: string;
  title: string;
  revenue: number;
  sold: number;
  held: number;
  available: number;
  checkedIn: number;
  ordersByStatus: Partial<Record<OrderStatus, number>>;
  salesByTier: { tier: string; sold: number; revenue: number }[];
};

export type SeatChange = { id: string; status: SeatStatus };

/** Socket.IO contract. */
export interface ServerToClientEvents {
  "seats:changed": (payload: { eventId: string; seats: SeatChange[] }) => void;
}
export interface ClientToServerEvents {
  "event:join": (eventId: string) => void;
  "event:leave": (eventId: string) => void;
}

export type ApiError = { error: { code: string; message: string; details?: unknown } };

/** Money is stored in halalas (1 SAR = 100). */
export function formatSar(halalas: number) {
  return new Intl.NumberFormat("en-SA", { style: "currency", currency: "SAR" }).format(halalas / 100);
}
