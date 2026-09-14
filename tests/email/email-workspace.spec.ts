import { expect, test } from '@playwright/test'

test('Email inbox is an authenticated CRM workspace', async ({ page }) => {
  await page.goto('/marketing/email', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Inbox', exact: true })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Email workspace' })).toBeVisible()
})
