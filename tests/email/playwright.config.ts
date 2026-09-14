import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.EMAIL_UI_BASE_URL
if (!baseURL) throw new Error('EMAIL_UI_BASE_URL is required before loading the email browser harness.')

export default defineConfig({
  testDir: __dirname,
  testMatch: 'email-workspace.spec.ts',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    extraHTTPHeaders: {
      'x-skc-test-auth-bypass': process.env.EMAIL_UI_AUTH_BYPASS_SECRET!,
      'x-skc-test-actor': process.env.EMAIL_UI_TEST_ACTOR!,
    },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
