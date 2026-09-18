import { expect, test } from '@playwright/test'

test('skips an undialable seller and recovers control without a call or takeover', async ({ page }) => {
  const sessionId = '11111111-1111-4111-8111-111111111111'
  const first = '22222222-2222-4222-8222-222222222222'
  const second = '33333333-3333-4333-8333-333333333333'
  let index = 0
  let operationHeld = true
  const mutations: string[] = []
  const session = () => ({
    id: sessionId, status: 'active', actorEmail: 'fixture@example.invalid', agentName: 'Fixture',
    queueKey: 'fixture', savedQueueId: null, leadIds: [first, second],
    queueItems: [first, second].map((id) => ({ kind: 'lead', id, leadId: id, prospectId: null, campaignMemberId: null })),
    queueSize: 2, currentIndex: index, currentLeadId: index ? second : first,
    currentSubjectKind: 'lead', currentSubjectId: index ? second : first,
    currentProspectId: null, currentCampaignMemberId: null, callerId: '+18165550101',
    settingsSnapshot: { campaignName: 'Andon recovery fixture' },
    dialsCompleted: 0, contacts: 0, skips: index, outcomes: {},
    startedAt: new Date().toISOString(), lastInteractionAt: new Date().toISOString(),
    idleExpiresAt: new Date(Date.now() + 300_000).toISOString(), idleTimedOutAt: null,
    updatedAt: new Date().toISOString(), pausedAt: null, stopRequestedAt: null, endedAt: null,
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const pathname = new URL(request.url()).pathname
    if (request.method() !== 'GET') mutations.push(`${request.method()} ${pathname}`)
    let body: unknown = {}
    if (pathname === `/api/dialer/sessions/${sessionId}`) {
      if (request.method() === 'PATCH') {
        expect(request.postDataJSON()).toEqual({ action: 'skip', reason: 'Agent skipped this contact' })
        index += 1
      }
      body = { session: session(), attempts: { items: [], pageInfo: { hasMore: false, nextCursor: null } } }
    } else if (pathname.endsWith('/control')) {
      expect(request.method()).toBe('PATCH')
      body = { session: session(), control: { generation: 1, operationActive: operationHeld, operationLabel: operationHeld ? 'Saving note' : null } }
    } else if (pathname === '/api/dialer/queue') {
      body = { leads: [first, second].map((id, i) => ({ id, full_name: i ? 'Next seller' : 'No callable numbers', phone: null, property_address: 'Fixture address' })), prospects: [], coOwners: [] }
    } else if (pathname === '/api/heirs') {
      body = { heirs: [], last_skip_traced_at: null }
    } else if (pathname.endsWith('/activities') || pathname.endsWith('/contact-notes')) {
      body = { activities: [] }
    } else if (pathname === '/api/twilio-token') {
      body = { error: 'No phone service in this isolated fixture' }
    } else if (pathname === '/api/call-log') {
      body = { calls: [] }
    }
    await route.fulfill({ json: body })
  })

  await page.goto(`/prospecting?session_id=${sessionId}`, { waitUntil: 'domcontentloaded' })
  const summary = page.getByRole('region', { name: 'Calling session summary' })
  await expect(summary).toContainText('Control unavailable')
  await expect(page.getByText(/Saving note.*still finishing/)).toBeVisible()
  operationHeld = false
  await page.getByRole('button', { name: 'Check dialing control' }).click()
  await expect(summary).toContainText('Ready')

  const skip = page.getByRole('button', { name: 'Skip seller', exact: true })
  await expect(skip).toBeEnabled()
  await skip.click()
  await expect(summary).toContainText('Next Seller')
  await expect(summary).toContainText('2 / 2')
  expect(index).toBe(1)
  expect(mutations.filter((request) => !request.endsWith('/control'))).toEqual([`PATCH /api/dialer/sessions/${sessionId}`])
})
