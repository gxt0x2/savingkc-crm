import { devices, expect, test, type Page, type Route, type TestInfo } from '@playwright/test'

import { buildOperatingReport } from '../../src/lib/operating-report'

const CRM_EMAIL = process.env.CRM_E2E_EMAIL?.trim()
const CRM_PASSWORD = process.env.CRM_E2E_PASSWORD?.trim()
const MAX_NAVIGATION_MS = 1_000
const MAX_TAB_MS = 500

const contact = {
  id: '00000000-0000-4000-8000-000000000001',
  fullName: 'Performance Seller',
  phone: '+18165550101',
  email: 'performance@example.com',
  source: 'google_ads',
  address: '101 Performance Way',
  city: 'Kansas City',
  station: 'new',
  classification: null,
  deadReason: null,
  owner: 'Ernest',
  score: 84,
  isFavorite: false,
  nextActivity: null,
  tags: ['Performance fixture'],
  lastContactAt: '2026-08-18T13:00:00.000Z',
  createdAt: '2026-08-18T12:00:00.000Z',
  firstOutboundAt: null,
  contactSignal: null,
  outreachStatus: 'not_contacted',
  updatedAt: '2026-08-18T13:00:00.000Z',
  pipelineIntentSource: 'google_ads',
  attentionState: 'waiting_on_contact',
  lastMessage: 'Performance fixture conversation is ready.',
  lastActivityAt: '2026-08-18T13:00:00.000Z',
  primaryNextAction: null,
}

const conversation = {
  id: contact.id,
  threadKey: `lead:${contact.id}`,
  kind: 'lead',
  full_name: contact.fullName,
  phone: contact.phone,
  email: contact.email,
  property_address: contact.address,
  city: contact.city,
  station: contact.station,
  priority: 'hot',
  assigned_agent: contact.owner,
  classification: contact.classification,
  source: contact.source,
  motivation_score: 8,
  created_at: contact.createdAt,
  attentionState: 'waiting_on_contact',
  owner: contact.owner,
  unread: false,
  lastMessage: 'Performance fixture conversation is ready.',
  lastActivityAt: contact.lastContactAt,
  lastChannel: 'sms',
  primaryNextAction: null,
}

const taskFixture = {
  id: 'performance-task-1',
  type: 'follow_up',
  title: 'Performance follow-up',
  description: 'Representative task data is ready.',
  contact_id: contact.id,
  deal_id: null,
  property_address: contact.address,
  due_date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  assigned_to: 'Ernest',
  status: 'pending',
  created_at: '2026-08-18T12:00:00.000Z',
  contact: { first_name: 'Performance', last_name: 'Seller' },
}

const reportFixture = buildOperatingReport({
  period: '30d',
  since: '2026-07-19T00:00:00.000Z',
  until: '2026-08-18T23:59:59.999Z',
  leads: [{
    id: contact.id,
    full_name: contact.fullName,
    property_address: contact.address,
    city: contact.city,
    source: 'google_ads',
    station: 'qualified',
    priority: 'hot',
    assigned_agent: contact.owner,
    opportunity_score: contact.score,
    is_favorite: false,
    phone: contact.phone,
    email: contact.email,
    created_at: contact.createdAt,
  }],
  referenceLeads: [],
  threads: [],
  activities: [],
  appointments: [],
  deals: [],
  offers: [],
  buyers: [],
  revenue: [],
  expenses: [],
  availability: {
    leads: true,
    conversations: true,
    appointments: true,
    dispositions: true,
    offers: true,
    buyers: true,
    finance: true,
    activityComplete: true,
  },
})

const apiFailures = new WeakMap<Page, string[]>()
const forbiddenRequests = new WeakMap<Page, string[]>()

async function attachTiming(testInfo: TestInfo, name: string, payload: unknown) {
  await testInfo.attach(name, {
    body: Buffer.from(`${JSON.stringify(payload, null, 2)}\n`),
    contentType: 'application/json',
  })
}

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
}

async function installPerformanceFixtures(page: Page) {
  await page.route('**/api/reports/operating**', (route) => fulfillJson(route, reportFixture))
  await page.route('**/api/contacts**', (route) => {
    const scope = new URL(route.request().url()).searchParams.get('scope')
    return fulfillJson(route, {
      items: scope === 'active' || !scope ? [contact] : [],
      scopeCounts: { active: 1, prospects: 0, not_leads: 0 },
    })
  })
  await page.route('**/api/conversations/hub**', (route) => fulfillJson(route, {
    items: [conversation],
    unmatchedActivities: [],
    pageInfo: { limit: 50, hasMore: false, nextCursor: null },
    source: 'projection',
    degraded: false,
  }))
  await page.route('**/api/conversations/timeline**', (route) => fulfillJson(route, {
    threadId: conversation.id,
    threadKey: conversation.threadKey,
    items: [{
      id: '00000000-0000-4000-8000-000000000002',
      lead_id: contact.id,
      activity_type: 'sms',
      type: 'sms',
      kind: 'message',
      channel: 'sms',
      direction: 'outbound',
      description: conversation.lastMessage,
      agent: contact.owner,
      metadata: { direction: 'outbound', from: '+18166088808', to: contact.phone },
      created_at: contact.lastContactAt,
    }],
    pageInfo: { limit: 50, hasMore: false, nextCursor: null },
    source: 'projection',
    degraded: false,
  }))
  await page.route('**/api/calendar/tasks**', (route) => fulfillJson(route, {
    success: true,
    tasks: [taskFixture],
  }))
  await page.route('**/api/tasks/worklist**', (route) => fulfillJson(route, {
    items: [{
      key: taskFixture.id,
      sourceKind: 'activity',
      sourceId: taskFixture.id,
      leadId: taskFixture.contact_id,
      tcFileId: null,
      kind: taskFixture.type,
      title: taskFixture.title,
      description: taskFixture.description,
      status: taskFixture.status,
      priority: 'normal',
      dueAt: taskFixture.due_date,
      assignedTo: taskFixture.assigned_to,
      department: 'acquisitions',
      role: null,
      primaryNextAction: false,
      version: 1,
      sourceCreatedAt: taskFixture.created_at,
      completedAt: null,
      updatedAt: taskFixture.created_at,
      contact: {
        id: contact.id,
        fullName: contact.fullName,
        phone: contact.phone,
        email: contact.email,
        propertyAddress: contact.address,
        city: contact.city,
        state: 'MO',
        zip: '64101',
        station: contact.station,
        createdAt: contact.createdAt,
      },
    }],
    counts: { all: 1, due_today: 0, overdue: 0, upcoming: 1, completed: 0 },
    pageInfo: { limit: 20, total: 1, hasMore: false, nextCursor: null },
    serverNow: '2026-08-21T15:00:00.000Z',
  }))
  await page.route('**/api/dialer/queue**', (route) => fulfillJson(route, {
    leads: [{
      id: contact.id,
      full_name: contact.fullName,
      phone: contact.phone,
      property_address: contact.address,
      city: contact.city,
      state: 'MO',
      source: contact.source,
      station: 'new',
      priority: 'hot',
      seller_situation: 'Performance fixture',
      motivation_score: 8,
      appointment_date: null,
      created_at: contact.createdAt,
      updated_at: contact.updatedAt,
    }],
    followups: [],
    contactActivities: [],
    prospects: [],
  }))
  await page.route('**/api/dialer/saved-lists**', (route) => fulfillJson(route, { savedLists: [] }))
  await page.route('**/api/prospecting/campaigns**', (route) => fulfillJson(route, {
    items: [],
    pageInfo: { limit: 50, hasMore: false, nextCursor: null },
  }))
  await page.route('**/api/settings**', (route) => fulfillJson(route, {
    profile: { email: 'performance@example.com', profile_photo_url: null },
  }))
  await page.route('**/api/call-review/access**', (route) => fulfillJson(route, { canReviewCalls: false }))
  await page.route('**/api/call-log**', (route) => fulfillJson(route, { calls: [] }))
  await page.route('**/api/feedback/log**', (route) => fulfillJson(route, { items: [], total: 0 }))
}

function watchSameOriginApiFailures(page: Page) {
  const failures: string[] = []
  const forbidden: string[] = []
  apiFailures.set(page, failures)
  forbiddenRequests.set(page, forbidden)

  const isSameOriginApi = (rawUrl: string) => {
    if (!page.url().startsWith('http')) return false
    const requestUrl = new URL(rawUrl)
    const pageUrl = new URL(page.url())
    return requestUrl.origin === pageUrl.origin && requestUrl.pathname.startsWith('/api/')
  }

  page.on('response', (response) => {
    if (response.status() >= 500 && isSameOriginApi(response.url())) {
      failures.push(`${response.request().method()} ${new URL(response.url()).pathname} returned ${response.status()}`)
    }
  })
  page.on('request', (request) => {
    const requestUrl = new URL(request.url())
    if (/^\/leads\/[^/]+\/?$/.test(requestUrl.pathname)) {
      forbidden.push(`unselected lead detail prefetched: ${requestUrl.pathname}`)
    }
    if (/fonts\.(?:googleapis|gstatic)\.com$/i.test(requestUrl.hostname)) {
      forbidden.push(`external render-blocking font requested: ${requestUrl.hostname}`)
    }
  })
  page.on('requestfailed', (request) => {
    if (isSameOriginApi(request.url())) {
      const errorText = request.failure()?.errorText ?? 'unknown error'
      // Fast route changes legitimately cancel work from the page being left.
      if (errorText === 'net::ERR_ABORTED') return
      failures.push(`${request.method()} ${new URL(request.url()).pathname} failed: ${errorText}`)
    }
  })
}

async function expectRouteReady(page: Page, route: string) {
  const pathname = new URL(route, 'http://performance.local').pathname
  if (pathname === '/dashboard') {
    await expect(page.getByText('Google - General', { exact: true })).toBeVisible()
    await expect(page.getByText('Operating data is temporarily unavailable')).toHaveCount(0)
    return
  }
  if (pathname === '/contacts') {
    await expect(page.getByText(contact.fullName, { exact: true }).first()).toBeVisible()
    await expect(page.getByLabel('Loading contact rows')).toHaveCount(0)
    return
  }
  if (pathname === '/conversations') {
    if ((page.viewportSize()?.width ?? 1280) < 768) {
      await expect(page.getByRole('button', { name: new RegExp(contact.fullName) }).first()).toBeVisible()
    } else {
      await expect(page.getByRole('heading', { name: contact.fullName, exact: true }).first()).toBeVisible()
    }
    await expect(page.getByRole('status', { name: 'Loading conversations' })).toHaveCount(0)
    return
  }
  if (pathname === '/prospecting') {
    await expect(page.getByRole('button', { name: 'Build campaign' }).first()).toBeVisible()
    await expect(page.getByText('Loading campaign', { exact: true })).toHaveCount(0)
    return
  }
  if (pathname === '/tasks') {
    await expect(page.getByText(taskFixture.title, { exact: true }).first()).toBeVisible()
    await expect(page.getByLabel('Loading task rows')).toHaveCount(0)
    return
  }
  if (pathname === '/calendar') {
    await expect(page.getByText(taskFixture.title, { exact: true }).first()).toBeVisible()
    await expect(page.getByText('Loading calendar...', { exact: true })).toHaveCount(0)
    return
  }
  if (pathname === '/dialer') {
    await expect(page.getByRole('heading', { name: 'Dialer overview' })).toBeVisible()
    await expect(page.getByText(contact.fullName, { exact: true }).first()).toBeVisible()
  }
}

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
  { label: 'Pipeline', href: '/contacts?list=new' },
  { label: 'Prospecting', href: '/prospecting' },
  { label: 'Task', href: '/tasks' },
  { label: 'Dashboard', href: '/dashboard' },
] as const

test.beforeEach(async ({ page }) => {
  await installPerformanceFixtures(page)
  watchSameOriginApiFailures(page)
})

test.afterEach(async ({ page }) => {
  expect(apiFailures.get(page) ?? [], 'No same-origin API may fail while a performance result is recorded').toEqual([])
  expect(forbiddenRequests.get(page) ?? [], 'Performance runs may not prefetch unselected lead details or external Google fonts').toEqual([])
})

for (const route of ['/dashboard', '/contacts?list=new', '/prospecting', '/conversations', '/tasks', '/calendar?department=acquisitions', '/dialer']) {
  test(`cold authenticated route is useful in under 1000ms on ${route}`, async ({ page }, testInfo) => {
    test.setTimeout(60_000)
    let startedAt = Date.now()
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    if (page.url().includes('/login')) {
      await ensureAuthenticated(page)
      startedAt = Date.now()
      await page.goto(route, { waitUntil: 'domcontentloaded' })
    }

    await expectRouteReady(page, route)
    const usefulPaint = Date.now() - startedAt
    await page.waitForFunction(() => performance.getEntriesByName('first-contentful-paint').length > 0)
    const firstContentfulPaint = await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? Number.POSITIVE_INFINITY)
    const timing = { route, firstContentfulPaint: Math.round(firstContentfulPaint), usefulPaint }
    console.info(`CRM_COLD_ROUTE=${JSON.stringify(timing)}`)
    await attachTiming(testInfo, 'cold-route-timing', timing)
    expect(firstContentfulPaint, `${route} cold FCP should stay under 1000ms`).toBeLessThan(MAX_NAVIGATION_MS)
    expect(usefulPaint, `${route} representative data should become usable within 1000ms`).toBeLessThan(MAX_NAVIGATION_MS)
  })
}

test('CRM navigation keeps the workspace mounted and reveals representative data promptly', async ({ page }, testInfo) => {
  test.setTimeout(120_000)
  await ensureAuthenticated(page)
  await expectRouteReady(page, '/dashboard')
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
    await expect(page).toHaveURL(new RegExp(`${transition.href.split('?')[0].replace('/', '\\/')}(?:\\?|$)`))
    await expectRouteReady(page, transition.href)
    const milliseconds = Date.now() - startedAt
    measured.push({ route: transition.href, milliseconds })

    await expect(page.locator('[data-navigation-performance-sentinel="persistent"]')).toHaveCount(1)
    expect.soft(milliseconds, `${transition.href} should become usable within 1000ms`).toBeLessThan(MAX_NAVIGATION_MS)
  }

  console.info(`CRM_NAVIGATION_TIMINGS=${JSON.stringify(measured)}`)
  await attachTiming(testInfo, 'desktop-navigation-timings', measured)
})

test('Pipeline and Task tab changes respond within 500ms', async ({ page }, testInfo) => {
  test.setTimeout(90_000)
  await ensureAuthenticated(page)
  await expectRouteReady(page, '/dashboard')

  await page.goto('/contacts?list=new', { waitUntil: 'domcontentloaded' })
  await expectRouteReady(page, '/contacts?list=new')
  const pipelineLists = page.getByRole('navigation', { name: 'Pipeline smart lists' })
  const pipelineTimings: Array<{ tab: string; milliseconds: number }> = []
  for (const label of ['Leads', 'Opportunities', 'Appointment Set', 'Offer Made', 'In Closing', 'All', 'New']) {
    const tab = pipelineLists.getByRole('button', { name: new RegExp(`^${label}\\s+\\d+$`, 'i') })
    const startedAt = Date.now()
    await tab.click()
    await expect(tab).toHaveAttribute('aria-current', 'page')
    const milliseconds = Date.now() - startedAt
    pipelineTimings.push({ tab: label, milliseconds })
    expect.soft(milliseconds, `${label} Pipeline tab should respond within 500ms`).toBeLessThan(MAX_TAB_MS)
  }

  await page.goto('/tasks', { waitUntil: 'domcontentloaded' })
  await expectRouteReady(page, '/tasks')
  const taskLists = page.getByRole('navigation', { name: 'Task smart lists' })
  const taskTimings: Array<{ tab: string; milliseconds: number }> = []
  for (const label of ['Due today', 'Overdue', 'Upcoming', 'Completed', 'All']) {
    const tab = taskLists.getByRole('button', { name: new RegExp(`^${label}\\s+\\d+$`, 'i') })
    const startedAt = Date.now()
    await tab.click()
    await expect(tab).toHaveAttribute('aria-current', 'page')
    const milliseconds = Date.now() - startedAt
    taskTimings.push({ tab: label, milliseconds })
    expect.soft(milliseconds, `${label} Task tab should respond within 500ms`).toBeLessThan(MAX_TAB_MS)
  }

  console.info(`CRM_TAB_TIMINGS=${JSON.stringify({ pipeline: pipelineTimings, tasks: taskTimings })}`)
  await attachTiming(testInfo, 'tab-timings', { pipeline: pipelineTimings, tasks: taskTimings })
})

test.describe('real iPhone navigation', () => {
  const iPhone = devices['iPhone 13']
  test.use({
    userAgent: iPhone.userAgent,
    viewport: iPhone.viewport,
    screen: iPhone.screen,
    deviceScaleFactor: iPhone.deviceScaleFactor,
    isMobile: iPhone.isMobile,
    hasTouch: iPhone.hasTouch,
  })

  test('mobile primary navigation reveals representative data within 1000ms', async ({ page }, testInfo) => {
    test.setTimeout(90_000)
    await ensureAuthenticated(page)
    await expectRouteReady(page, '/dashboard')
    const mobileNavigation = page.getByRole('navigation', { name: 'Primary CRM navigation' })
    const mobileTransitions = [
      { label: 'Pipeline', href: '/contacts?list=new' },
      { label: 'Prospecting', href: '/prospecting' },
      { label: 'Task', href: '/tasks' },
      { label: 'Dashboard', href: '/dashboard' },
    ] as const
    const measured: Array<{ route: string; milliseconds: number }> = []

    for (const transition of mobileTransitions) {
      const link = mobileNavigation.getByRole('link', { name: new RegExp(`${transition.label}$`, 'i') })
      await expect(link).toBeVisible()
      const startedAt = Date.now()
      await link.click()
      await expectRouteReady(page, transition.href)
      const milliseconds = Date.now() - startedAt
      measured.push({ route: transition.label, milliseconds })
      expect.soft(milliseconds, `${transition.label} mobile navigation should become usable within 1000ms`).toBeLessThan(MAX_NAVIGATION_MS)
    }

    console.info(`CRM_MOBILE_NAVIGATION_TIMINGS=${JSON.stringify(measured)}`)
    await attachTiming(testInfo, 'mobile-navigation-timings', measured)
  })
})
