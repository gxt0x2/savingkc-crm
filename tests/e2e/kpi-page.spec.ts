import { expect, test } from '@playwright/test'

test.use({
  extraHTTPHeaders: {
    'x-skc-test-auth-bypass': 'playwright-smoke-bypass',
  },
})

test('dashboard bottleneck calculator smoke', async ({ page }) => {
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })
  await page.getByText('Open model', { exact: true }).click()

  const calculator = page.getByTestId('bottleneck-calculator')
  await expect(calculator.getByRole('heading', { name: 'Left Main Bottleneck Calculator' })).toBeVisible()

  const current = page.getByTestId('scenario-current')
  const optimized = page.getByTestId('scenario-optimized')

  await expect(current.getByLabel('Current State total leads')).toHaveValue('100')
  await expect(optimized.getByLabel('Optimized State total leads')).toHaveValue('100')
  await expect(current.getByText('$17,280')).toBeVisible()
  await expect(optimized.getByText('$30,720')).toBeVisible()

  await current.getByLabel('Lead Qualification rate').fill('35')
  await current.getByLabel('Lead Qualification rate').blur()
  await expect(current.getByText('$20,160')).toBeVisible()
  await expect(optimized.getByText('+14%')).toBeVisible()

  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('scenario-current').getByLabel('Lead Qualification rate')).toHaveValue('30')
  await expect(page.getByTestId('scenario-current').getByText('$17,280')).toBeVisible()

  const reloadedCurrent = page.getByTestId('scenario-current')
  await reloadedCurrent.getByLabel('Current State average deal margin').fill('50000')
  await reloadedCurrent.getByLabel('Current State average deal margin').blur()
  await expect(reloadedCurrent.getByText('$86,400')).toBeVisible()

  for (const label of [
    'Lead Qualification rate',
    'Opportunity to Appointment rate',
    'Opportunity to Contract rate',
    'Contract to Assignment rate',
    'Assignment to Closing rate',
  ]) {
    await reloadedCurrent.getByLabel(label).fill('0')
    await reloadedCurrent.getByLabel(label).blur()
  }

  await expect(reloadedCurrent.getByText('$0')).toBeVisible()
  await expect(page.getByText(/^NaN$/)).toHaveCount(0)
})
