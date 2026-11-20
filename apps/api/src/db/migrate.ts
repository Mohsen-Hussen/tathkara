import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb, type Db } from "./client.js";
import { loadConfig } from "../config.js";

export const MIGRATIONS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../drizzle");

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { db, pool } = createDb(loadConfig().databaseUrl);
  await runMigrations(db);
  await pool.end();
  console.log("Migrations applied.");
}
