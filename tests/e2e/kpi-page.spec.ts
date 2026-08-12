import { expect, test } from '@playwright/test'

import { buildOperatingReport } from '../../src/lib/operating-report'

test.use({
  extraHTTPHeaders: {
    'x-skc-test-auth-bypass': 'playwright-smoke-bypass',
  },
  viewport: { width: 1600, height: 1000 },
})

const report = buildOperatingReport({
  period: '30d',
  since: '2026-07-03T00:00:00.000Z',
  until: '2026-08-02T18:00:00.000Z',
  leads: [
    { id: 'lead-1', full_name: 'Seller One', property_address: '1 Main St', city: 'Kansas City', source: 'google_ads', station: 'qualified', priority: 'hot', assigned_agent: 'Ernest', opportunity_score: 82, is_favorite: false, phone: '+18165550100', email: 'one@example.com', created_at: '2026-07-10T12:00:00.000Z' },
  ],
  referenceLeads: [],
  threads: [],
  activities: [],
  appointments: [],
  deals: [],
  offers: [],
  buyers: [],
  revenue: [],
  expenses: [],
  availability: { leads: true, conversations: true, appointments: true, dispositions: true, offers: true, buyers: true, finance: true, activityComplete: true },
})

test('CEO operating dashboard and report drill-down smoke', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('crm-theme', 'light'))
  await page.route('**/api/reports/operating**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) })
  })
  await page.route('**/api/feedback/log**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
  })

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'CEO Operating System' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Open phone dialer' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: /Switch to (light|dark) theme/ })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Notifications' })).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Open user menu' })).toHaveCount(1)
  const andon = page.getByRole('button', { name: 'Raise an Andon and report an issue' })
  await expect(andon).toBeVisible()
  await andon.click()
  await expect(page.getByRole('dialog', { name: 'Report an issue' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Process issue' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'AI Glitch' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Core work area' })).toHaveValue('Marketing')
  await expect(page.getByRole('combobox', { name: 'Specific process' })).toHaveValue('List Import Error')
  await expect(page.getByRole('textbox', { name: 'Why 5' })).toBeVisible()
  await page.getByRole('button', { name: 'Close Andon form' }).click()
  const metrics = page.getByRole('region', { name: 'Company operating metrics' })
  await expect(metrics.getByRole('link', { name: /Revenue/ })).toBeVisible({ timeout: 20_000 })
  await expect(metrics.getByRole('link', { name: /Opportunities/ })).toBeVisible()
  await expect(metrics.getByRole('link', { name: /Offers made/ })).toBeVisible()
  await expect(metrics.getByRole('link', { name: /Under contract/ })).toBeVisible()
  await expect(metrics.getByRole('link', { name: /Leads/ })).toBeVisible()
  await expect(page.getByText('Attributed leads', { exact: true })).toBeVisible()
  await expect(page.getByText('Google - General', { exact: true })).toBeVisible()
  const metricLabels = await metrics.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')?.split(':')[0]))
  expect(metricLabels).toEqual(['Revenue (period)', 'Pipeline est. revenue', 'Closings (period)', 'Assigned (period)', 'Under contract', 'Offers made', 'Opportunities (period)', 'Leads (period)'])
  const metricRows = await metrics.getByRole('link').evaluateAll((links) => links.map((link) => Math.round(link.getBoundingClientRect().top)))
  expect(new Set(metricRows).size).toBe(1)

  const period = page.getByRole('combobox', { name: 'Reporting period' })
  await expect(period.getByRole('option', { name: 'Today' })).toHaveCount(1)
  await expect(period.getByRole('option', { name: 'Custom range' })).toHaveCount(1)
  await period.selectOption('custom')
  await expect(page.getByRole('textbox', { name: 'Reporting start date' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Reporting end date' })).toBeVisible()
  await period.selectOption('quarter')
  await expect(period).toHaveValue('quarter')

  await page.getByRole('link', { name: /Issue Log/ }).first().click()
  await expect(page).toHaveURL(/\/reports\/andon$/)
  await expect(page.getByRole('heading', { name: 'Issue Log' })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Andon date range' })).toHaveValue('30d')
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })

  await metrics.getByRole('link', { name: /Revenue/ }).click()
  await expect(page).toHaveURL(/\/reports\/finance$/)
  await expect(page.getByRole('heading', { name: 'Financial performance' })).toBeVisible()

  await page.goto('/reports/acquisitions', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Acquisitions performance', level: 1 })).toBeVisible()
  const acquisitionMetrics = page.getByRole('region', { name: 'Acquisition operating metrics' })
  await expect(acquisitionMetrics.getByRole('link')).toHaveCount(5)
  const acquisitionMetricLabels = await acquisitionMetrics.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')?.split(':')[0]))
  expect(acquisitionMetricLabels).toEqual([
    'Meaningful conversations',
    'Speed to lead',
    'Opportunities',
    'Appointments attended',
    'Under contract',
  ])
  await expect(page.getByRole('heading', { name: 'Lead-source performance' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Revenue lift model' })).toBeVisible()
  await expect(page.locator('[data-nextjs-dialog]')).toHaveCount(0)

})
