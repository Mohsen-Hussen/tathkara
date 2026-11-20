import type { ApiError } from "@tathkara/shared";

export class ApiRequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

/** One refresh at a time: parallel 401s all wait for the same refresh call. */
function refreshSession() {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
    .then((r) => r.ok)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}, retried = false): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...rest,
    headers: { ...(json !== undefined ? { "content-type": "application/json" } : {}), ...rest.headers },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  // Access tokens are short-lived; renew silently and replay the request once.
  if (res.status === 401 && !retried && !path.startsWith("/auth/")) {
    if (await refreshSession()) return api<T>(path, init, true);
  }
  if (res.status === 204) return undefined as T;
  const body = (await res.json().catch(() => null)) as T | ApiError | null;
  if (!res.ok) {
    const err = (body as ApiError | null)?.error;
    throw new ApiRequestError(
      res.status,
      err?.code ?? "unknown",
      err?.message ?? "Something went wrong.",
      err?.details,
    );
  }
  return body as T;
}
