import { expect, test, type Page } from '@playwright/test'

const CRM_EMAIL = process.env.CRM_E2E_EMAIL?.trim()
const CRM_PASSWORD = process.env.CRM_E2E_PASSWORD?.trim()

async function ensureAuthenticated(page: Page) {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  if (!page.url().includes('/login')) return

  if (!CRM_EMAIL || !CRM_PASSWORD) {
    throw new Error('CRM navigation verification requires CRM_E2E_EMAIL and CRM_E2E_PASSWORD when the explicit local test bypass is unavailable. Configure a dedicated test user; never commit login fallbacks.')
  }

  await page.locator('input[type="email"]').fill(CRM_EMAIL)
  await page.locator('input[type="password"]').fill(CRM_PASSWORD)
  await Promise.all([
    page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 30_000 }),
    page.getByRole('button', { name: 'Sign In', exact: true }).click(),
  ])
  await page.waitForLoadState('domcontentloaded')
}

const transitions = [
  { label: 'Pipeline', href: '/contacts', readyHeading: /New|Leads|Opportunities/i },
  { label: 'Conversations', href: '/conversations', readyHeading: /Conversations/i },
  { label: 'Dialer', href: '/dialer', readyHeading: /Dialer/i },
  { label: 'Task', href: '/tasks', readyHeading: /Task/i },
  { label: 'Dashboard', href: '/dashboard', readyHeading: /CEO Operating System/i },
] as const

test('CRM navigation keeps the workspace mounted and reveals each destination promptly', async ({ page }) => {
  test.setTimeout(120_000)
  page.on('pageerror', (error) => console.error(`CRM_PAGE_ERROR=${error.stack ?? error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`CRM_CONSOLE_ERROR=${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    const url = new URL(request.url())
    if (url.origin === new URL(page.url() || 'http://localhost').origin && url.pathname.startsWith('/api/')) {
      console.error(`CRM_REQUEST_FAILED=${request.method()} ${url.pathname} ${request.failure()?.errorText ?? 'unknown'}`)
    }
  })
  await ensureAuthenticated(page)
  await expect(page.locator('.crm-workspace-shell')).toBeVisible()
  await page.locator('.crm-workspace-shell').evaluate((element) => {
    element.setAttribute('data-navigation-performance-sentinel', 'persistent')
  })

  const measured: Array<{ route: string; milliseconds: number }> = []
  for (const transition of transitions) {
    const link = page
      .getByRole('navigation', { name: 'CRM navigation' })
      .getByRole('link', { name: transition.label })
      .first()
    await expect(link).toBeVisible()

    const startedAt = Date.now()
    await link.click()
    await expect(page).toHaveURL(new RegExp(`${transition.href.replace('/', '\\/')}(?:\\?|$)`))
    await expect(page.getByRole('heading', { name: transition.readyHeading }).first()).toBeVisible()
    const milliseconds = Date.now() - startedAt
    measured.push({ route: transition.href, milliseconds })

    await expect(page.locator('[data-navigation-performance-sentinel="persistent"]')).toHaveCount(1)
    expect.soft(milliseconds, `${transition.href} should become usable within 1000ms`).toBeLessThan(1_000)
  }

  console.info(`CRM_NAVIGATION_TIMINGS=${JSON.stringify(measured)}`)
})
