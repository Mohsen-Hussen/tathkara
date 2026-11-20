import { count, eq } from "drizzle-orm";
import type { Deps } from "../context.js";
import { events, orderSeats, orders, seats, tickets, users } from "./schema.js";
import { hashPassword } from "../lib/password.js";
import { ticketCode } from "../lib/codes.js";

export const DEMO_PASSWORD = "demo1234";

export const DEMO_USERS = [
  { name: "Nora Al-Rashid", email: "nora@tathkara.app", role: "organizer" as const },
  { name: "Ali Hassan", email: "ali@tathkara.app", role: "customer" as const },
  { name: "Sara Khalid", email: "sara@tathkara.app", role: "customer" as const },
  { name: "Box Office", email: "box-office@tathkara.app", role: "customer" as const },
];

type Tier = { name: string; rows: string[]; price: number };
type Layout = { sections: { name: string; seatsPerRow: number; tiers: Tier[] }[] };

const THEATRE: Layout = {
  sections: [
    {
      name: "Orchestra",
      seatsPerRow: 16,
      tiers: [
        { name: "VIP", rows: ["A", "B"], price: 450_00 },
        { name: "Premium", rows: ["C", "D", "E", "F"], price: 275_00 },
        { name: "Standard", rows: ["G", "H", "I", "J"], price: 140_00 },
      ],
    },
  ],
};

const ARENA: Layout = {
  sections: [
    {
      name: "Courtside",
      seatsPerRow: 14,
      tiers: [{ name: "Courtside", rows: ["A", "B"], price: 600_00 }],
    },
    {
      name: "Lower bowl",
      seatsPerRow: 18,
      tiers: [
        { name: "Lower", rows: ["C", "D", "E", "F", "G"], price: 220_00 },
        { name: "Upper", rows: ["H", "I", "J", "K"], price: 95_00 },
      ],
    },
  ],
};

const HALL: Layout = {
  sections: [
    {
      name: "Main hall",
      seatsPerRow: 12,
      tiers: [
        { name: "Founder pass", rows: ["A", "B", "C"], price: 1200_00 },
        { name: "General", rows: ["D", "E", "F", "G", "H"], price: 350_00 },
      ],
    },
  ],
};

const EVENTS = [
  {
    slug: "symphony-under-the-stars",
    title: "Symphony Under the Stars",
    description:
      "An evening of film scores and Arabic classics performed by a 60-piece orchestra, with a guest oud soloist for the second half.",
    venue: "King Fahd Cultural Centre",
    city: "Riyadh",
    category: "Concert",
    accent: "#4f46e5",
    inDays: 12,
    hour: 20,
    layout: THEATRE,
    soldRatio: 0.38,
  },
  {
    slug: "jeddah-hoops-final",
    title: "Jeddah Hoops — League Final",
    description: "The two best teams of the season meet for the title. Doors open 90 minutes before tip-off.",
    venue: "Corniche Arena",
    city: "Jeddah",
    category: "Sports",
    accent: "#ea580c",
    inDays: 5,
    hour: 19,
    layout: ARENA,
    soldRatio: 0.55,
  },
  {
    slug: "founders-summit-2027",
    title: "Founders Summit 2027",
    description:
      "A day of talks and workshops from founders who scaled across the Gulf, plus an investor meet-up in the evening.",
    venue: "Dhahran Expo",
    city: "Dammam",
    category: "Conference",
    accent: "#059669",
    inDays: 26,
    hour: 9,
    layout: HALL,
    soldRatio: 0.22,
  },
];

/** Deterministic pseudo-random numbers so every seed looks the same. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function seed(deps: Pick<Deps, "db" | "now">) {
  const { db } = deps;
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const created = await db
    .insert(users)
    .values(DEMO_USERS.map((u) => ({ ...u, passwordHash })))
    .returning();
  const organizer = created.find((u) => u.role === "organizer")!;
  const boxOffice = created.find((u) => u.email.startsWith("box-office"))!;
  const random = rng(2027);
  const now = deps.now();

  for (const e of EVENTS) {
    const startsAt = new Date(now.getTime() + e.inDays * 86_400_000);
    startsAt.setUTCHours(e.hour - 3, 0, 0, 0); // local time in Saudi Arabia (UTC+3)
    const [event] = await db
      .insert(events)
      .values({ ...e, organizerId: organizer.id, startsAt })
      .returning();

    const rows = e.layout.sections.flatMap((section) =>
      section.tiers.flatMap((tier) =>
        tier.rows.flatMap((row) =>
          Array.from({ length: section.seatsPerRow }, (_, i) => ({
            eventId: event!.id,
            section: section.name,
            row,
            number: i + 1,
            tier: tier.name,
            price: tier.price,
          })),
        ),
      ),
    );
    const inserted = await db.insert(seats).values(rows).returning({ id: seats.id, price: seats.price });

    // Pre-sell a share of seats in small groups, the way real orders arrive.
    const toSell = inserted.filter(() => random() < e.soldRatio);
    for (let i = 0; i < toSell.length;) {
      const group = toSell.slice(i, i + 1 + Math.floor(random() * 4));
      i += group.length;
      const total = group.reduce((s, x) => s + x.price, 0);
      const paidAt = new Date(now.getTime() - Math.floor(random() * 20) * 86_400_000);
      const [order] = await db
        .insert(orders)
        .values({
          userId: boxOffice.id,
          eventId: event!.id,
          status: "paid",
          total,
          expiresAt: paidAt,
          paidAt,
          createdAt: paidAt,
        })
        .returning();
      await db.insert(orderSeats).values(group.map((s) => ({ orderId: order!.id, seatId: s.id, price: s.price })));
      for (const s of group) {
        await db.update(seats).set({ status: "sold", orderId: order!.id }).where(eq(seats.id, s.id));
      }
      await db.insert(tickets).values(group.map((s) => ({ orderId: order!.id, seatId: s.id, code: ticketCode() })));
    }
  }
}

export async function seedIfEmpty(deps: Pick<Deps, "db" | "now">) {
  const [{ n }] = (await deps.db.select({ n: count() }).from(users)) as [{ n: number }];
  if (n > 0) return false;
  await seed(deps);
  return true;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { loadConfig } = await import("../config.js");
  const { createDb } = await import("./client.js");
  const { runMigrations } = await import("./migrate.js");
  const config = loadConfig();
  const { db, pool } = createDb(config.databaseUrl);
  await runMigrations(db);
  const seeded = await seedIfEmpty({ db, now: () => new Date() });
  console.log(seeded ? "Seeded demo data." : "Database already has data — skipped.");
  await pool.end();
}
