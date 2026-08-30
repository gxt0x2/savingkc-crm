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
    id: '44444444-4444-4444-8444-444444444444', subjectKind: 'lead', leadId: '33333333-3333-4333-8333-333333333333', prospectId: null, enrollmentSource: 'crm_lead', phone: '+18165550123', timezone: 'America/Chicago', status: 'active', suppressionReason: null, currentStepPosition: 1, nextActionAt: '2026-08-22T14:00:00.000Z', enrolledAt: '2026-08-21T10:30:00.000Z', readyContactCount: 2, suppressedContactCount: 0,
    lead: { fullName: 'Helen Seller', propertyAddress: '123 Main Street', station: 'prospect', classification: 'warm' },
  }],
  stats: { total: 10, active: 7, suppressed: 1, replied: 2, completed: 1, sent: 8, failed: 0 },
}

const dialerCampaign = {
  ...campaign,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'County Tax Delinquent 2-Year — Pilot',
  kind: 'dialer',
  callerId: '+18163077835',
  fromPhone: null,
  steps: [],
  stats: { total: 85, active: 84, needsReview: 0, suppressed: 1, replied: 0, completed: 0, sent: 0, delivered: 0, failed: 0 },
}

const durableSessionId = '55555555-5555-4555-8555-555555555555'

function activeDialerSession(status: 'active' | 'paused' | 'stopped' = 'active') {
  return {
    id: durableSessionId,
    status,
    actorEmail: 'ernest@savingkc.com',
    agentName: 'Ernest',
    queueKey: dialerCampaign.name,
    savedQueueId: null,
    leadIds: [dialerCampaign.members[0].leadId],
    queueItems: [{ kind: 'lead', id: dialerCampaign.members[0].leadId, leadId: dialerCampaign.members[0].leadId, prospectId: null, campaignMemberId: dialerCampaign.members[0].id }],
    queueSize: 1,
    currentIndex: 0,
    currentLeadId: dialerCampaign.members[0].leadId,
    currentProspectId: null,
    currentSubjectKind: 'lead',
    currentSubjectId: dialerCampaign.members[0].leadId,
    currentCampaignMemberId: dialerCampaign.members[0].id,
    callerId: dialerCampaign.callerId,
    dialsCompleted: 0,
    contacts: 0,
    skips: 0,
    outcomes: {},
    startedAt: '2026-08-25T12:00:00.000Z',
    pausedAt: status === 'paused' ? '2026-08-25T12:20:00.000Z' : null,
    endedAt: status === 'stopped' ? '2026-08-25T12:30:00.000Z' : null,
    updatedAt: '2026-08-25T12:00:00.000Z',
  }
}

function fulfill(route: Route, body: unknown) {
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function mockCampaigns(page: Page, writesEnabled = true) {
  await page.route('**/api/prospecting/campaigns**', (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/activity')) return fulfill(route, { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } })
    if (pathname.endsWith('/members')) return fulfill(route, { items: dialerCampaign.members, pageInfo: { limit: 50, hasMore: false, nextCursor: null } })
    if (pathname.endsWith(dialerCampaign.id)) return fulfill(route, { campaign: dialerCampaign, capabilities: { writesEnabled } })
    if (pathname.endsWith(campaign.id)) return fulfill(route, { campaign, capabilities: { writesEnabled } })
    return fulfill(route, { items: [dialerCampaign, campaign], pageInfo: { limit: 50, hasMore: false, nextCursor: null } })
  })
}

async function mockCallingPreview(page: Page) {
  await page.route('**/api/dialer/queue?**', (route) => fulfill(route, {
    leads: [{ id: dialerCampaign.members[0].leadId, full_name: 'Helen Seller', phone: '+18165550123', email: null, property_address: '123 Main Street', city: 'Kansas City', state: 'MO', zip: '64108', county: 'Jackson', is_favorite: false }],
    prospects: [],
    coOwners: [],
  }))
  await page.route('**/api/heirs?**', (route) => fulfill(route, {
    last_skip_traced_at: '2026-08-24T12:00:00.000Z',
    heirs: [{
      key: 'heir-1', contact_name: 'Helen Seller', relationship: 'owner', address: null, unattempted_count: 2,
      phones: [
        { id: 'phone-1', number: '+18165550123', type: 'mobile', connected: null, attempted: false, last_disposition: null, last_attempt_at: null },
        { id: 'phone-2', number: '+18165550124', type: 'mobile', connected: null, attempted: false, last_disposition: null, last_attempt_at: null },
      ],
    }],
  }))
  await page.route('**/api/leads/*/activities?**', (route) => fulfill(route, { activities: [] }))
  await page.route('**/api/prospecting/contact-notes**', (route) => route.fulfill({
    status: route.request().method() === 'GET' ? 200 : 201,
    contentType: 'application/json',
    body: JSON.stringify(route.request().method() === 'GET'
      ? { activities: [] }
      : { activity: { id: 'activity-1' } }),
  }))
}

test('live dialer picker hides draft and Pilot campaigns and omits status from the selected chip', async ({ page }) => {
  const live = {
    ...dialerCampaign,
    id: '74609ed4-7e26-4111-b626-b2e3f68efa0b',
    name: 'Casey · Jackson · Tax 3+ · 7 zips · Aug 30',
  }
  const pilot = {
    ...dialerCampaign,
    id: '5c45d2f7-c120-4477-bb1f-f04d69c4efdf',
    name: 'County Tax Delinquent 2-Year — Pilot',
  }
  const draft = {
    ...dialerCampaign,
    id: '8d94a8d6-e3cd-4ab7-983c-44efcf8c92a2',
    name: 'August Absentee',
    status: 'draft',
  }

  await page.route('**/api/prospecting/campaigns**', (route) => {
    const pathname = new URL(route.request().url()).pathname
    if (pathname.endsWith('/activity')) return fulfill(route, { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } })
    if (pathname.endsWith('/members')) return fulfill(route, { items: live.members, pageInfo: { limit: 50, hasMore: false, nextCursor: null } })
    if (pathname.endsWith(live.id)) return fulfill(route, { campaign: live, capabilities: { writesEnabled: true } })
    return fulfill(route, { items: [pilot, draft, live], pageInfo: { limit: 50, hasMore: false, nextCursor: null } })
  })

  await page.goto(`/prospecting?campaign=${live.id}`, { waitUntil: 'domcontentloaded' })

  const picker = page.getByRole('combobox', { name: 'Choose campaign' })
  await expect(page.getByRole('heading', { name: live.name })).toBeVisible()
  await expect(picker).toBeVisible()
  await expect(picker).toHaveValue(live.id)
  await expect(picker.locator('option')).toHaveCount(1)
  await expect(picker.locator('option')).toHaveText(live.name)
  await expect(picker).not.toContainText('active')
  await expect(picker).not.toContainText('2026-08-30')
  await expect(picker.getByRole('option', { name: /Pilot/ })).toHaveCount(0)
  await expect(picker.getByRole('option', { name: draft.name })).toHaveCount(0)
})

test('Prospecting makes the agent calling workflow obvious and keeps management secondary', async ({ page }) => {
  await mockCampaigns(page)
  await page.goto(`/prospecting?campaign=${dialerCampaign.id}`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: dialerCampaign.name })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Choose campaign' })).toBeVisible()
  await expect(page.getByText('84', { exact: true })).toBeVisible()
  await expect(page.getByText('ready to call')).toBeVisible()
  await expect(page.getByRole('button', { name: /Start calling session|Resume calling/ })).toBeVisible()
  await expect(page.getByText('All associated contacts stay visible')).toBeVisible()
  await expect(page.getByText('Audience health')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Campaign details/ })).toHaveAttribute('aria-expanded', 'false')
  await page.getByRole('button', { name: /Campaign details/ }).click()
  await expect(page.getByText('Audience health')).toBeVisible()
  await expect(page.getByText('Protected at every action')).toBeVisible()
  await page.getByRole('button', { name: 'Build another campaign' }).click()
  await expect(page.getByRole('heading', { name: 'What are we launching?' })).toBeVisible()
  await page.getByRole('textbox', { name: /Campaign name/ }).fill('October owner outreach')
  await page.getByRole('button', { name: /SMS cadence/ }).click()
  await page.getByRole('button', { name: /Continue/ }).click()

  await expect(page.getByRole('heading', { name: 'Build the conversation.' })).toBeVisible()
  await expect(page.getByText('Draft preview · not sent')).toBeVisible()
  await expect(page.getByRole('button', { name: /Add message/ })).toBeVisible()
})

test('Prospecting keeps campaign choice and session start clear on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await mockCampaigns(page)
  await page.goto(`/prospecting?campaign=${dialerCampaign.id}`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('combobox', { name: 'Choose campaign' })).toBeVisible()
  await expect(page.getByText('84', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Start calling session|Resume calling/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /Campaign details/ })).toBeVisible()
  await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll')
})

test('a read-only deployment opens the real calling workflow without exposing mutations', async ({ page }) => {
  const mutationRequests: string[] = []
  page.on('request', (request) => {
    if (
      request.url().includes('/api/')
      && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())
    ) {
      mutationRequests.push(`${request.method()} ${new URL(request.url()).pathname}`)
    }
  })
  await mockCampaigns(page, false)
  await mockCallingPreview(page)
  await page.goto(`/prospecting?campaign=${dialerCampaign.id}`, { waitUntil: 'domcontentloaded' })

  await page.getByRole('button', { name: 'Preview call session' }).click()
  await expect(page).toHaveURL(new RegExp(`preview_campaign=${dialerCampaign.id}`))
  await expect(page.getByRole('heading', { name: 'Calling workflow preview' })).toBeVisible()
  await expect(page.getByText(/Preview only .* calling controls are shown but disabled/i)).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open live calling' })).toHaveCount(0)
  const liveStatus = page.getByRole('region', { name: 'Today’s acquisition metrics' })
  await expect(liveStatus).toBeVisible()
  await expect(liveStatus.locator('article')).toHaveCount(5)
  await expect(page.getByText('Caller ID')).toBeVisible()
  await expect(page.getByText('Sellers worked')).toHaveCount(0)
  await expect(page.getByText('Dialer time')).toBeVisible()
  await expect(page.getByText('Calls', { exact: true })).toBeVisible()
  await expect(page.getByText('Contacts', { exact: true })).toBeVisible()
  await expect(liveStatus.getByText('Seller progress', { exact: true })).toBeVisible()
  await expect(page.getByText('Reach the right person')).toHaveCount(0)
  await expect(page.getByRole('heading', { name: /Callable people/ })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Call all 2 numbers' })).toBeDisabled()
  const personPhoneRun = page.getByRole('button', { name: 'Call 2 numbers for Helen Seller' })
  await expect(personPhoneRun).toBeDisabled()
  await expect(personPhoneRun).toBeVisible()
  await expect(personPhoneRun).toContainText('Call 2 numbers')
  await expect(page.getByText('(816) 555-0123', { exact: true })).toBeVisible()
  await expect(page.getByText('(816) 555-0124', { exact: true })).toBeVisible()
  await expect(page.getByText(/2 ready numbers shown · no call attempt will be recorded/i)).toHaveCount(0)
  const previewNote = page.getByRole('textbox', { name: 'Note for Helen Seller' })
  await expect(previewNote).toBeVisible()
  await expect(previewNote).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Save note' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Calling unavailable in read-only preview' })).toHaveCount(2)
  await expect(page.getByRole('button', { name: 'Hang up current call' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Pause session' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Skip seller' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'End session' })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Dead Lead' })).toBeDisabled()
  await expect(page.getByText(/Texting is visible for workflow review but disabled/i)).toBeVisible()
  await expect(page.getByRole('textbox', { name: 'Type a text...' })).toHaveCount(0)
  expect(mutationRequests).toEqual([])
})

test('the live calling floor has an explicit end-session flow and a bounded theme-aware context rail', async ({ page }) => {
  let transitionBody: unknown = null
  await page.addInitScript(() => window.localStorage.setItem('crm-theme', 'light'))
  await mockCampaigns(page)
  await mockCallingPreview(page)
  await page.route(`**/api/dialer/sessions/${durableSessionId}`, async (route) => {
    if (route.request().method() === 'PATCH') {
      transitionBody = route.request().postDataJSON()
      return fulfill(route, { session: activeDialerSession('stopped') })
    }
    return fulfill(route, { session: activeDialerSession('paused') })
  })
  await page.route(`**/api/dialer/sessions/${durableSessionId}/pre-call-brief`, (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'Brief unavailable in browser fixture' }),
  }))

  await page.goto(`/prospecting?session_id=${durableSessionId}&return_to=%2Fprospecting`, { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('heading', { name: 'Calling session' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'End session' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Back to campaigns' })).toBeVisible()
  await expect(page.getByText('Recent Calls', { exact: true })).toHaveCount(0)
  const note = page.getByRole('textbox', { name: 'Note for Helen Seller' })
  await expect(note).toBeVisible()
  await note.fill('Daughter is the best contact after 5 PM.')
  await note.locator('xpath=ancestor::form').getByRole('button', { name: 'Save note' }).click()
  await expect(page.getByText('Note saved to this contact.')).toBeVisible()

  const commandBackground = await page.getByRole('region', { name: 'Calling floor command center' }).evaluate((element) => getComputedStyle(element).backgroundColor)
  expect(commandBackground).toBe('rgb(255, 255, 255)')

  const contextRail = page.getByRole('complementary', { name: 'Seller context' })
  const railStyle = await contextRail.evaluate((element) => ({
    maxHeight: getComputedStyle(element).maxHeight,
    overflowY: getComputedStyle(element).overflowY,
  }))
  expect(railStyle.maxHeight).not.toBe('none')
  expect(['auto', 'scroll']).toContain(railStyle.overflowY)

  await page.getByRole('button', { name: 'End session' }).click()
  const dialog = page.getByRole('dialog', { name: 'Stop this session?' })
  await expect(dialog).toBeVisible()
  await dialog.getByRole('button', { name: 'End session' }).click()
  await expect(page).toHaveURL(/\/prospecting$/)
  expect(transitionBody).toEqual({ action: 'request_stop' })
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
