import { defineConfig } from "@playwright/test";
import "dotenv/config";

const PORT = Number(process.env.PORT ?? 3000);
const baseURL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;
// Optional: point at a preinstalled Chromium (e.g. in a container).
const executablePath = process.env.PW_CHROMIUM_PATH || undefined;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL, trace: "off", launchOptions: { executablePath } },
  projects: [
    {
      name: "phone",
      use: { browserName: "chromium", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 1 },
    },
    { name: "desktop", use: { browserName: "chromium", viewport: { width: 1280, height: 800 } } },
  ],
  webServer: {
    command: process.env.CI ? "pnpm start" : "pnpm dev",
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { AUTH_RATE_LIMIT: "off" },
  },
});
