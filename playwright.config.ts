import { defineConfig, devices } from "@playwright/test";

/**
 * E2E runs against a server you start yourself (dev or prod build) pointed at a throwaway
 * database, never your real one:
 *   E2E_BASE_URL   default http://localhost:3001
 *   E2E_SERVER_LOG path to that server's stdout, where console-mode sign-in links appear
 * Uses the system Chrome (no browser download).
 *
 * The "setup" project signs the owner in once through the real sign-in form and saves the
 * session, so the suite requests one magic link per run (they're rate limited, as they should be).
 */
export const OWNER_STATE = "tests/e2e/.auth/owner.json";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3001",
    channel: "chrome",
    trace: "retain-on-failure",
    colorScheme: "dark",
  },
  projects: [
    { name: "setup", testMatch: /.*\.setup\.ts/ },
    {
      name: "desktop",
      dependencies: ["setup"],
      use: {
        viewport: { width: 1280, height: 860 },
        storageState: OWNER_STATE,
      },
    },
    {
      name: "phone",
      dependencies: ["setup"],
      use: {
        ...devices["Pixel 7"],
        channel: "chrome",
        storageState: OWNER_STATE,
      },
    },
  ],
});
