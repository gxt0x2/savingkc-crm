import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.route('**/api/conversations/hub', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ threads: [] }) })
  })
})

test('phone system, workflow registry, AI surface, and dialer navigation are connected', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/workflows')
  await expect(page.getByRole('heading', { name: 'Workflows', exact: true })).toBeVisible()
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)

  const mainNav = page.getByRole('navigation', { name: 'CRM navigation' })
  const destinations = await mainNav.getByRole('link').evaluateAll((links) =>
    links.map((link) => link.getAttribute('href')),
  )
  expect(destinations.indexOf('/dialer')).toBe(destinations.indexOf('/conversations') + 1)

  await page.locator('a[href="/workflows?section=phones"]').first().click()
  await expect(page).toHaveURL(/\/workflows\?section=phones/)
  await expect(page.getByRole('heading', { name: 'Master Phone System' })).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(21)

  await page.locator('tbody tr').first().click()
  await expect(page.getByRole('dialog')).toContainText('Inbound path')
  await expect(page.getByRole('dialog')).toContainText('Carrier fallback')
  await page.getByRole('button', { name: 'Close details' }).click()

  const carrierAudit = page.getByRole('button', { name: /Verify live carrier|Carrier verified|Carrier unavailable|Retry carrier audit/ })
  await carrierAudit.click()
  await expect(carrierAudit).not.toHaveText('Checking carrier…', { timeout: 30_000 })
  await page.screenshot({ path: '/tmp/savingkc-phone-system.png', fullPage: true })

  await page.locator('a[href="/workflows?section=all"]').first().click()
  await expect(page).toHaveURL(/\/workflows\?section=all/)
  await expect(page.getByRole('heading', { name: 'All Workflows' })).toBeVisible()
  expect(await page.locator('tbody tr').count()).toBeGreaterThan(20)
  await page.locator('tbody tr').first().click()
  await expect(page.getByRole('dialog')).toContainText('Action sequence')
  await expect(page.getByRole('dialog')).toContainText('Implementation')
  await page.getByRole('button', { name: 'Close details' }).click()

  await page.locator('a[href="/ai"]').first().click()
  await expect(page).toHaveURL(/\/ai/)
  await expect(page.getByRole('heading', { name: 'AI Assistant', exact: true })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Ask ARI' })).toBeEnabled()
  await expect(page.getByText('Execution boundary')).toBeVisible()
  await page.getByRole('button', { name: 'Clear' }).click()
  await expect(page.getByText('Conversation cleared. What would you like me to inspect or plan?')).toBeVisible()
  await page.screenshot({ path: '/tmp/savingkc-ai-assistant.png', fullPage: true })
})
