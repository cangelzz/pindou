import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  // Tests share the harness HTML file but each test boots a fresh page.
  // Force serial to avoid harness-write race.
  fullyParallel: false,
  workers: 1,
  use: {
    browserName: "chromium",
    viewport: { width: 1200, height: 800 },
  },
  projects: [
    {
      name: "webview",
      testMatch: /.*\.(spec|test)\.ts$/,
    },
  ],
});
