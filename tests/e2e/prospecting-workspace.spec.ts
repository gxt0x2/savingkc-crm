import { expect, test, type Page, type Route } from '@playwright/test'

const campaign = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'September absentee owners',
  kind: 'sms',
  status: 'active',
  ownerEmail: 'ernest@savingkc.com',
  ownerName: 'Ernest',
  callerId: null,
  fromPhone: '+18165550101',
  defaultTimezone: 'America/Chicago',
  perHour: 75,
  perDay: 500,
  createdAt: '2026-08-21T10:00:00.000Z',
  updatedAt: '2026-08-21T11:00:00.000Z',
  activatedAt: '2026-08-21T11:00:00.000Z',
  pausedAt: null,
  completedAt: null,
  steps: [
    { id: 'step-1', position: 1, delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, this is {{agent_name}} with SavingKC. Would you consider an offer on {{property_address}}?' },
    { id: 'step-2', position: 2, delayMinutes: 1440, bodyTemplate: 'Just following up about {{property_address}}. Is selling something you would consider this year?' },
  ],
  members: [{
    id: 'member-1', leadId: 'lead-1', phone: '+18165550123', timezone: 'America/Chicago', status: 'active', suppressionReason: null, currentStepPosition: 1, nextActionAt: '2026-08-22T14:00:00.000Z', enrolledAt: '2026-08-21T10:30:00.000Z',
    lead: { fullName: 'Helen Seller', propertyAddress: '123 Main Street', station: 'prospect', classification: 'warm' },
  }],
  stats: { total: 10, active: 7, suppressed: 1, replied: 2, completed: 1, sent: 8, failed: 0 },
}

function fulfill(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function mockCampaigns(page: Page) {
  await page.route('**/api/prospecting/campaigns**', (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith(campaign.id)) return fulfill(route, { campaign })
    return fulfill(route, { items: [campaign], pageInfo: { limit: 50, hasMore: false, nextCursor: null } })
  })
}

test('Prospecting renders a real campaign operating dashboard and guided studio', async ({ page }) => {
  await mockCampaigns(page)
  await page.goto('/prospecting', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: campaign.name })).toBeVisible()
  await expect(page.getByText('25% reply rate')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'The conversation sellers receive' })).toBeVisible()
  await expect(page.getByText('Stops immediately when a seller replies or opts out.')).toBeVisible()

  await page.getByRole('button', { name: 'Build campaign' }).first().click()
  await expect(page.getByRole('heading', { name: 'What are we launching?' })).toBeVisible()
  await page.getByRole('textbox', { name: /Campaign name/ }).fill('October owner outreach')
  await page.getByRole('button', { name: /SMS cadence/ }).click()
  await page.getByRole('button', { name: /Continue/ }).click()

  await expect(page.getByRole('heading', { name: 'Build the conversation.' })).toBeVisible()
  await expect(page.getByText('Draft preview · not sent')).toBeVisible()
  await expect(page.getByRole('button', { name: /Add message/ })).toBeVisible()
})

test('Prospecting studio remains usable on a phone-sized viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockCampaigns(page)
  await page.goto('/prospecting?new=1', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'What are we launching?' })).toBeVisible()
  await expect(page.getByRole('button', { name: /Power dialer/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /SMS cadence/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Continue/ })).toBeVisible()
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll')
})
