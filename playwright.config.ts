import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 4300);

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    ...(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {}),
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // The production build: the API serves the React app, so the browser sees one origin.
    command: "node apps/api/dist/server.js",
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      NODE_ENV: "production",
      PORT: String(PORT),
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/tathkara",
      JWT_SECRET: "e2e-jwt-secret-e2e-jwt-secret-e2e-jwt-secret",
      WEBHOOK_SECRET: "e2e-webhook-secret-123",
      WEB_DIST: "apps/web/dist",
      SEED_ON_START: "true",
      LOG_LEVEL: "warn",
    },
  },
});
