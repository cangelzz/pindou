import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  use: {
    viewport: { width: 1200, height: 800 },
  },
  projects: [
    {
      name: "extension",
      testMatch: /.*\.(spec|test)\.ts$/,
    },
  ],
});
