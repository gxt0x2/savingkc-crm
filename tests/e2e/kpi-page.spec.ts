import { expect, test } from '@playwright/test'

import { buildOperatingReport } from '../../src/lib/operating-report'

test.use({
  extraHTTPHeaders: {
    'x-skc-test-auth-bypass': 'playwright-smoke-bypass',
  },
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
  await page.route('**/api/reports/operating**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) })
  })

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'CEO Operating System' })).toBeVisible()
  const metrics = page.getByRole('region', { name: 'Company operating metrics' })
  await expect(metrics.getByText('Revenue', { exact: true })).toBeVisible()
  await expect(metrics.getByText('Qualified', { exact: true })).toBeVisible()
  await expect(metrics.getByText('Leads', { exact: true })).toBeVisible()

  const period = page.getByRole('combobox', { name: 'Reporting period' })
  await period.selectOption('quarter')
  await expect(period).toHaveValue('quarter')

  await metrics.getByRole('link', { name: /Revenue/ }).click()
  await expect(page).toHaveURL(/\/reports\/finance$/)
  await expect(page.getByRole('heading', { name: 'Financial performance' })).toBeVisible()
})
