import { expect, test } from '@playwright/test'

const transitions = [
  { label: 'Contacts', href: '/contacts', readyHeading: /All|New|Hot|Leads|Opportunities/i },
  { label: 'Conversations', href: '/conversations', readyHeading: /Conversations/i },
  { label: 'Dialer', href: '/dialer', readyHeading: /Dialer/i },
  { label: 'Workflows', href: '/workflows', readyHeading: /Workflows/i },
  { label: 'Dashboard', href: '/dashboard', readyHeading: /CEO Operating System/i },
] as const

test('CRM navigation keeps the workspace mounted and reveals each destination promptly', async ({ page }) => {
  test.setTimeout(120_000)
  page.on('pageerror', (error) => console.error(`CRM_PAGE_ERROR=${error.stack ?? error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`CRM_CONSOLE_ERROR=${message.text()}`)
  })
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
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
    expect(milliseconds, `${transition.href} should become usable within 1500ms`).toBeLessThan(1_500)
  }

  console.info(`CRM_NAVIGATION_TIMINGS=${JSON.stringify(measured)}`)
})
