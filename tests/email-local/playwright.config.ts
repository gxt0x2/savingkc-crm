import { defineConfig } from '@playwright/test'
export default defineConfig({
  testDir: '.',
  testMatch: ['workflow.spec.ts', 'contact-rules.spec.ts'],
  workers: 1,
  timeout: 45000,
  outputDir: '../../test-results/email-local',
  use: {
    channel: 'chrome',
    baseURL: 'http://127.0.0.1:3211',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: {
    gracefulShutdown: { signal: 'SIGTERM', timeout: 10000 },
    command: 'EMAIL_LOCAL_PORT=3211 node tests/email-local/start.mjs',
    cwd: '../..',
    url: 'http://127.0.0.1:3211',
    reuseExistingServer: false,
    timeout: 60000,
  },
})
