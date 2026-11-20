import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { Role, User } from "@tathkara/shared";
import type { Deps } from "../context.js";
import { refreshTokens, users } from "../db/schema.js";
import { AppError, unauthorized } from "../lib/errors.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { randomToken, sha256 } from "../lib/codes.js";

export type AccessClaims = { sub: string; role: Role; name: string; email: string };

const key = (deps: Deps) => new TextEncoder().encode(deps.config.jwtSecret);

export async function signAccessToken(deps: Deps, user: User) {
  return new SignJWT({ role: user.role, name: user.name, email: user.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt(Math.floor(deps.now().getTime() / 1000))
    .setExpirationTime(Math.floor(deps.now().getTime() / 1000) + deps.config.accessTokenTtlSeconds)
    .setIssuer("tathkara")
    .sign(key(deps));
}

export async function verifyAccessToken(deps: Deps, token: string): Promise<User | null> {
  try {
    const { payload } = await jwtVerify(token, key(deps), {
      issuer: "tathkara",
      algorithms: ["HS256"],
      currentDate: deps.now(),
    });
    return {
      id: payload.sub!,
      role: payload.role as Role,
      name: payload.name as string,
      email: payload.email as string,
    };
  } catch {
    return null;
  }
}

async function issueRefreshToken(deps: Deps, userId: string, familyId: string = randomUUID()) {
  const token = randomToken(32);
  const expiresAt = new Date(deps.now().getTime() + deps.config.refreshTokenTtlDays * 86_400_000);
  await deps.db.insert(refreshTokens).values({ userId, familyId, tokenHash: sha256(token), expiresAt });
  return { token, expiresAt };
}

async function sessionFor(deps: Deps, user: User, familyId?: string) {
  const [accessToken, refresh] = await Promise.all([
    signAccessToken(deps, user),
    issueRefreshToken(deps, user.id, familyId),
  ]);
  return { user, accessToken, refreshToken: refresh.token, refreshExpiresAt: refresh.expiresAt };
}

const publicUser = (u: typeof users.$inferSelect): User => ({ id: u.id, name: u.name, email: u.email, role: u.role });

export async function register(deps: Deps, input: { name: string; email: string; password: string }) {
  const passwordHash = await hashPassword(input.password);
  const [user] = await deps.db
    .insert(users)
    .values({ ...input, passwordHash })
    .onConflictDoNothing()
    .returning();
  if (!user) throw new AppError(409, "email_taken", "An account with this email already exists.");
  return sessionFor(deps, publicUser(user));
}

// Compared against when the email is unknown, so both failure paths take the same time.
const DUMMY_HASH = hashPassword("timing-equaliser-not-a-real-password");

export async function login(deps: Deps, input: { email: string; password: string }) {
  const [user] = await deps.db.select().from(users).where(eq(users.email, input.email));
  const ok = await verifyPassword(input.password, user?.passwordHash ?? (await DUMMY_HASH));
  if (!user || !ok) throw unauthorized("Email or password is incorrect.");
  return sessionFor(deps, publicUser(user));
}

/**
 * Refresh-token rotation with reuse detection: each token works once. If an already-used
 * token shows up again, someone copied it, so every token in that login family is revoked.
 */
export async function refresh(deps: Deps, token: string | undefined) {
  if (!token) throw unauthorized();
  const now = deps.now();
  const outcome = await deps.db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(token)))
      .for("update");
    if (!row || row.revokedAt || row.expiresAt <= now) return { kind: "invalid" as const };
    if (row.usedAt) {
      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
      return { kind: "reused" as const };
    }
    await tx.update(refreshTokens).set({ usedAt: now }).where(eq(refreshTokens.id, row.id));
    const [user] = await tx.select().from(users).where(eq(users.id, row.userId));
    return { kind: "ok" as const, user: publicUser(user!), familyId: row.familyId };
  });
  if (outcome.kind === "reused")
    throw new AppError(401, "token_reused", "This session was signed out for your security.");
  if (outcome.kind === "invalid") throw unauthorized("Your session has ended. Please sign in again.");
  return sessionFor(deps, outcome.user, outcome.familyId);
}

export async function logout(deps: Deps, token: string | undefined) {
  if (!token) return;
  const [row] = await deps.db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, sha256(token)));
  if (row) {
    await deps.db
      .update(refreshTokens)
      .set({ revokedAt: deps.now() })
      .where(and(eq(refreshTokens.familyId, row.familyId), isNull(refreshTokens.revokedAt)));
  }
}
