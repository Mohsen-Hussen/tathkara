import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiRequestError } from "./api";

const json = (status: number, body: unknown) =>
  new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

afterEach(() => vi.unstubAllGlobals());

describe("api client", () => {
  it("refreshes once for many parallel 401s, then replays each request", async () => {
    let refreshed = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/auth/refresh") {
        await new Promise((r) => setTimeout(r, 10));
        refreshed = true;
        return json(200, {});
      }
      return refreshed ? json(200, { ok: url }) : json(401, { error: { code: "unauthorized", message: "no" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const results = await Promise.all([api("/tickets"), api("/inbox"), api("/orders")]);
    expect(results).toEqual([{ ok: "/api/tickets" }, { ok: "/api/inbox" }, { ok: "/api/orders" }]);
    expect(fetchMock.mock.calls.filter(([u]) => u === "/api/auth/refresh")).toHaveLength(1);
  });

  it("surfaces the server's error code and details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(409, { error: { code: "seats_unavailable", message: "Taken", details: { seatIds: ["a"] } } }),
      ),
    );
    const error = await api("/events/x/holds", { method: "POST", json: {} }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect(error).toMatchObject({ status: 409, code: "seats_unavailable", details: { seatIds: ["a"] } });
  });
});
