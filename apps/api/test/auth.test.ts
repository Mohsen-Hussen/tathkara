import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, createHarness, type Harness } from "./harness.js";

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(() => h.close());

describe("auth", () => {
  it("registers, keeps tokens in httpOnly cookies and never returns them in the body", async () => {
    const c = client(h.app);
    const res = await c.post("/api/auth/register", { name: "Maha", email: "Maha@Example.com", password: "s3curePass" });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual({ user: expect.objectContaining({ email: "maha@example.com", role: "customer" }) });
    expect(res.body).not.toMatch(/token/i);
    const cookies = res.cookies.map((k) => ({
      name: k.name,
      httpOnly: k.httpOnly,
      sameSite: k.sameSite,
      path: k.path,
    }));
    expect(cookies).toEqual([
      { name: "tk_at", httpOnly: true, sameSite: "Strict", path: "/" },
      { name: "tk_rt", httpOnly: true, sameSite: "Strict", path: "/api/auth" },
    ]);
    expect((await c.get("/api/auth/me")).json().user.name).toBe("Maha");
  });

  it("rejects duplicate emails and weak passwords with field-level errors", async () => {
    const c = client(h.app);
    const dup = await c.post("/api/auth/register", {
      name: "Ali",
      email: "ali@tathkara.app",
      password: "another1pass",
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe("email_taken");

    const weak = await c.post("/api/auth/register", { name: "A", email: "nope", password: "short" });
    expect(weak.statusCode).toBe(400);
    expect(weak.json().error.code).toBe("validation_failed");
    expect(weak.json().error.details.length).toBeGreaterThanOrEqual(3);
  });

  it("gives the same answer for an unknown email and a wrong password", async () => {
    const c = client(h.app);
    const a = await c.post("/api/auth/login", { email: "ghost@tathkara.app", password: "whatever1" });
    const b = await c.post("/api/auth/login", { email: "ali@tathkara.app", password: "wrong-password1" });
    expect(a.statusCode).toBe(401);
    expect(a.json()).toEqual(b.json());
  });

  it("rotates refresh tokens and revokes the whole session when an old one is replayed", async () => {
    const c = client(h.app);
    await c.login("sara@tathkara.app");
    const stolen = c.jar.get("tk_rt")!;

    const first = await c.post("/api/auth/refresh");
    expect(first.statusCode).toBe(200);
    expect(c.jar.get("tk_rt")).not.toBe(stolen);
    const current = c.jar.get("tk_rt")!;

    // An attacker replays the token that was already rotated away…
    const attacker = client(h.app);
    attacker.jar.set("tk_rt", stolen);
    const replay = await attacker.post("/api/auth/refresh");
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe("token_reused");

    // …so the legitimate session's newest token is revoked too.
    const victim = client(h.app);
    victim.jar.set("tk_rt", current);
    expect((await victim.post("/api/auth/refresh")).statusCode).toBe(401);
  });

  it("expires access tokens after 15 minutes", async () => {
    const c = client(h.app);
    await c.login("ali@tathkara.app");
    expect((await c.get("/api/auth/me")).statusCode).toBe(200);
    h.clock.advance(16 * 60_000);
    expect((await c.get("/api/auth/me")).statusCode).toBe(401);
    expect((await c.post("/api/auth/refresh")).statusCode).toBe(200);
    expect((await c.get("/api/auth/me")).statusCode).toBe(200);
  });

  it("logs out by revoking the refresh token", async () => {
    const c = client(h.app);
    await c.login("ali@tathkara.app");
    const token = c.jar.get("tk_rt")!;
    expect((await c.post("/api/auth/logout")).statusCode).toBe(204);
    const replay = client(h.app);
    replay.jar.set("tk_rt", token);
    expect((await replay.post("/api/auth/refresh")).statusCode).toBe(401);
  });

  it("rate-limits password guessing", async () => {
    const c = client(h.app);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++)
      statuses.push(
        (await c.post("/api/auth/login", { email: "ali@tathkara.app", password: `guess${i}xx` })).statusCode,
      );
    expect(statuses).toContain(429);
  });
});
