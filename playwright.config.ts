import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 1 : "50%",
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
    { name: "firefox", use: { browserName: "firefox" } },
    // Linux WebKit in CI can freeze its whole web process while starting MSE playback
    // (the page stops answering and the browser takes ~30 s to close). One retry absorbs that;
    // the report still lists such tests as flaky.
    { name: "webkit", use: { browserName: "webkit" }, retries: process.env.CI ? 1 : 0 },
  ],
  webServer: {
    command: "npm run serve",
    url: "http://127.0.0.1:4173/examples/basic/",
    reuseExistingServer: false,
  },
});
