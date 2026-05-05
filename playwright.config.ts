import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3002';
const useManagedWebServer = !process.env.PLAYWRIGHT_BASE_URL;
const authProxyTestBypassSecret = 'playwright-smoke-bypass';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    extraHTTPHeaders: useManagedWebServer
      ? { 'x-skc-test-auth-bypass': authProxyTestBypassSecret }
      : undefined,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: useManagedWebServer
    ? {
        command: `AUTH_PROXY_TEST_BYPASS_SECRET=${authProxyTestBypassSecret} npm run start -- --port 3002`,
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120000,
      }
    : undefined,
});
