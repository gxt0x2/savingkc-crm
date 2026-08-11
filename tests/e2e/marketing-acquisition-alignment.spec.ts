import { expect, test } from '@playwright/test'

import { buildOperatingReport, type OperatingReportInput } from '../../src/lib/operating-report'

test.use({
  extraHTTPHeaders: {
    'x-skc-test-auth-bypass': 'playwright-smoke-bypass',
  },
  viewport: { width: 1600, height: 1000 },
})

const leads: OperatingReportInput['leads'] = [
  ...sourceLeads('inbound_ivr_no_input', 7),
  ...sourceLeads('Tax Delinquent Inbound Sms', 4),
  ...sourceLeads('inbound_call', 3),
  ...sourceLeads('google_ads', 2),
  ...sourceLeads('inbound_sms', 1),
]

const report = buildOperatingReport({
  period: '30d',
  since: '2026-07-12T00:00:00.000Z',
  until: '2026-08-10T23:59:59.999Z',
  leads,
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

test('marketing attribution and acquisition KPIs stay aligned', async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('crm-theme', 'light'))
  await page.route('**/api/reports/operating**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(report) })
  })

  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' })

  const marketing = page.getByRole('heading', { name: 'Marketing', exact: true }).locator('xpath=ancestor::section')
  await expect(marketing.getByText('Attributed leads', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(marketing.getByText('7', { exact: true })).toBeVisible()
  for (const source of ['Google - General', 'Google - Tax', 'Cold Calls', 'Cold SMS', 'YouTube']) {
    await expect(marketing.getByText(source, { exact: true })).toBeVisible()
  }
  await expect(marketing.getByText('Inbound IVR', { exact: true })).toHaveCount(0)
  await expect(marketing.getByText('Tax Delinquent Inbound Sms', { exact: true })).toHaveCount(0)

  const departmentFlow = page.getByRole('region', { name: 'Department operating flow' })
  const departmentRows = await departmentFlow.getByRole('heading').evaluateAll((headings) => headings.map((heading) => ({
    label: heading.textContent?.trim(),
    top: Math.round(heading.closest('section')?.getBoundingClientRect().top ?? 0),
  })))
  expect(departmentRows.map(({ label }) => label)).toEqual(['Marketing', 'Acquisitions', 'Dispositions', 'Revenue'])
  expect(departmentRows[0].top).toBe(departmentRows[1].top)
  expect(departmentRows[2].top).toBe(departmentRows[3].top)
  expect(departmentRows[2].top).toBeGreaterThan(departmentRows[0].top)

  await page.goto('/reports/acquisitions', { waitUntil: 'domcontentloaded' })

  const metrics = page.getByRole('region', { name: 'Acquisition operating metrics' })
  await expect(metrics.getByRole('link')).toHaveCount(5)
  const labels = await metrics.getByRole('link').evaluateAll((links) => links.map((link) => link.getAttribute('aria-label')?.split(':')[0]))
  expect(labels).toEqual([
    'Meaningful conversations',
    'Speed to lead',
    'Qualified',
    'Appointments attended',
    'Under contract',
  ])
  expect(await metrics.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)

  await page.setViewportSize({ width: 900, height: 1000 })
  for (const label of labels) {
    await expect(metrics.getByRole('link', { name: new RegExp(`^${label}:`) })).toBeVisible()
  }
  expect(await metrics.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true)
})

function sourceLeads(source: string, count: number): OperatingReportInput['leads'] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${source}-${index}`,
    full_name: `${source} Seller ${index}`,
    property_address: null,
    city: null,
    source,
    station: 'new',
    priority: null,
    assigned_agent: null,
    opportunity_score: 0,
    is_favorite: false,
    phone: null,
    email: null,
    created_at: '2026-08-01T12:00:00.000Z',
  }))
}
