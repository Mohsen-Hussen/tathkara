import { mkdtempSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { TestProject } from "vitest/node";

/**
 * Integration tests run against a real PostgreSQL (row locks and SKIP LOCKED are the
 * point of these tests, so an in-memory fake wouldn't prove anything).
 * CI provides one through TEST_DATABASE_URL; locally we boot an embedded server.
 */
export default async function setup(project: TestProject) {
  if (process.env.TEST_DATABASE_URL) {
    project.provide("adminUrl", process.env.TEST_DATABASE_URL);
    return;
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dir = mkdtempSync(path.join(tmpdir(), "tathkara-pg-"));
  chmodSync(dir, 0o777); // initdb refuses to run as root, so it runs as a "postgres" user
  const port = 55_000 + Math.floor(Math.random() * 5_000);
  const pg = new EmbeddedPostgres({
    databaseDir: path.join(dir, "data"),
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  project.provide("adminUrl", `postgres://postgres:postgres@localhost:${port}/postgres`);
  return async () => {
    await pg.stop();
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    adminUrl: string;
  }
}
