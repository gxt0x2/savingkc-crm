import { test, expect } from '@playwright/test'
import type {
  PilotState,
  PilotThread,
} from '../../src/lib/email/workflow/types'

test('focused workspace: prepared reply, CRM handoff, notes, schedule and unsubscribe', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'Campaigns', exact: true }).click()
  await page
    .getByLabel('Campaign name', { exact: true })
    .fill('Verified browser pilot')
  await page.getByRole('button', { name: 'New campaign', exact: true }).click()
  await page.getByRole('button', { name: 'Save sequence', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Draft updated')
  await page.getByRole('button', { name: 'Recipients', exact: true }).click()
  await page
    .getByRole('button', { name: 'Review saved campaign', exact: true })
    .click()
  await expect(
    page.getByRole('heading', { name: '2 ready · 1 excluded' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Start reviewed simulation', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Pause this campaign', exact: true }),
  ).toBeVisible()
  await page.getByText('Local testing controls', { exact: true }).click()
  await page
    .getByRole('button', {
      name: 'Process next simulated message',
      exact: true,
    })
    .click()
  await expect(page.getByRole('status')).toContainText('One message accepted')
  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await page.getByRole('button', { name: /^All/ }).click()
  await page
    .getByRole('region', { name: 'Conversations', exact: true })
    .getByRole('button')
    .first()
    .click()
  expect(
    (await page
      .getByRole('region', { name: 'Conversations', exact: true })
      .boundingBox())!.y,
  ).toBeLessThan(280)
  const receive = page.getByRole('button', {
    name: 'Receive practice reply in selected conversation',
    exact: true,
  })
  await receive.click()
  await expect(page.getByRole('status')).toContainText(
    'Pending sequence messages are stopped',
  )
  await page.getByRole('button', { name: 'Take over', exact: true }).click()
  await expect(
    page.getByText('Practice suggestion · Live AI is not connected'),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Create Lead & callback', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'The Lead and callback review task are linked',
  )
  await expect(
    page.getByRole('button', { name: 'Details', exact: true }),
  ).toHaveAttribute('aria-expanded', 'true')
  const drawer = page.getByRole('complementary', {
    name: 'Contact and property',
  })
  await expect(
    drawer.getByRole('tab', { name: 'Next step', exact: true }),
  ).toHaveAttribute('aria-selected', 'true')
  await drawer
    .getByRole('button', { name: 'Accept callback', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Callback accepted')
  await expect(
    drawer.getByRole('button', { name: 'Callback accepted', exact: true }),
  ).toBeDisabled()
  await page.getByRole('button', { name: /^Alerts/ }).click()
  const alerts = page.getByRole('region', { name: 'Your Email alerts' })
  await expect(alerts).toBeVisible()
  await alerts
    .getByRole('button', { name: /^Open / })
    .first()
    .click()
  await expect(alerts).toBeHidden()
  await expect(
    page
      .getByRole('region', { name: 'Selected conversation' })
      .getByRole('region', { name: 'Next action' }),
  ).toHaveCount(0)
  await drawer.getByRole('tab', { name: 'Contact', exact: true }).click()
  await expect(
    drawer.getByText('Lead · Contacted', { exact: true }),
  ).toBeVisible()
  await drawer.getByRole('tab', { name: 'Property', exact: true }).click()
  await expect(
    drawer.getByRole('tabpanel', { name: 'Property', exact: true }),
  ).toBeVisible()
  await drawer.getByRole('tab', { name: 'Ari’s Insights', exact: true }).click()
  await expect(
    drawer.getByRole('tabpanel', { name: 'Ari’s Insights', exact: true }),
  ).toContainText('Live insights aren’t connected yet')
  await drawer.getByRole('tab', { name: 'Notes', exact: true }).click()
  await drawer
    .getByLabel('Add a note', { exact: true })
    .fill('Seller prefers afternoon calls.')
  await drawer.getByRole('tab', { name: 'Contact', exact: true }).click()
  await drawer.getByRole('tab', { name: 'Notes', exact: true }).click()
  await expect(drawer.getByLabel('Add a note', { exact: true })).toHaveValue(
    'Seller prefers afternoon calls.',
  )
  await drawer.getByRole('button', { name: 'Save note', exact: true }).click()
  await expect(
    drawer.getByText('Seller prefers afternoon calls.', { exact: true }),
  ).toBeVisible()
  await drawer.getByRole('tab', { name: 'Calendar', exact: true }).click()
  await expect(drawer.getByLabel('Title', { exact: true })).toBeHidden()
  await drawer.getByRole('button', { name: 'Scheduler', exact: true }).click()
  await drawer.getByRole('combobox', { name: 'Schedule', exact: true }).selectOption('callback')
  await drawer
    .getByLabel('Title', { exact: true })
    .fill('Call seller to confirm timing')
  await drawer
    .getByLabel('Task notes', { exact: true })
    .fill('Ask which afternoon time works best.')
  await drawer
    .getByLabel('Follow-up time (Chicago)', { exact: true })
    .fill('2026-09-15T14:00')
  await drawer
    .getByRole('button', { name: 'Save follow-up', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Follow-up task saved')
  await expect(drawer.getByLabel('Title', { exact: true })).toBeHidden()
  await expect(drawer).toContainText('Sep 15, 2:00 PM CT')
  const agenda = drawer.getByRole('region', {
    name: 'Upcoming',
  })
  await expect(agenda).toContainText('Call seller to confirm timing')
  await expect(agenda).toContainText('Sep 15, 2:00 PM CT')
  await expect(agenda.getByLabel('Filter task type')).toBeHidden()
  await agenda.getByRole('button', { name: 'Filters', exact: true }).click()
  await agenda.getByLabel('Filter task type').selectOption('callback')
  await agenda.getByLabel('Filter assignee').selectOption('Demo owner')
  await expect(agenda.getByRole('article')).toHaveCount(1)
  await expect(agenda).toContainText(
    'Google Calendar events are not connected.',
  )
  await drawer.getByRole('button', { name: 'Scheduler', exact: true }).click()
  await drawer.getByRole('combobox', { name: 'Schedule', exact: true }).selectOption('new')
  await drawer.getByRole('combobox', { name: 'Type', exact: true }).selectOption('appointment')
  await drawer.getByLabel('Title', { exact: true }).fill('Property walkthrough')
  await drawer
    .getByLabel('Date and time (Chicago)', { exact: true })
    .fill('2026-09-16T14:00')
  await drawer
    .getByRole('button', { name: 'Save appointment', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('CRM appointment saved')
  await agenda.getByLabel('Filter task type').selectOption('')
  await expect(agenda).toContainText('Property walkthrough')
  await expect(agenda).toContainText(
    'CRM appointment task · no Calendar booking verified',
  )
  await expect(agenda.getByRole('article')).toHaveCount(2)
  await drawer.getByRole('button', { name: 'Scheduler', exact: true }).click()
  await drawer.getByRole('combobox', { name: 'Type', exact: true }).selectOption('task')
  await drawer
    .getByLabel('Title', { exact: true })
    .fill('Review property details')
  await drawer
    .getByLabel('Date and time (Chicago)', { exact: true })
    .fill('2026-09-17T10:00')
  await drawer.getByRole('button', { name: 'Create task', exact: true }).click()
  await expect(agenda).toContainText('Review property details')
  await expect(agenda.getByRole('article')).toHaveCount(3)
  await drawer.getByRole('button', { name: 'Scheduler', exact: true }).click()
  await page.screenshot({ path: 'test-results/email-local/scheduler-desktop.png', fullPage: true, animations: 'disabled' })
  await drawer.getByRole('button', { name: 'Scheduler', exact: true }).click()
  await drawer.getByText('Record call outcome', { exact: true }).click()
  await drawer
    .getByLabel('Call result', { exact: true })
    .selectOption('no_contact')
  await expect(
    drawer.getByLabel('Next action time (Chicago)', { exact: true }),
  ).toBeVisible()
  await expect(
    drawer.getByRole('button', {
      name: 'Save outcome & follow-up',
      exact: true,
    }),
  ).toBeDisabled()
  await drawer.getByText('Record call outcome', { exact: true }).click()
  await page
    .getByRole('button', { name: 'Local testing controls', exact: true })
    .click()
  await page.screenshot({
    path: 'test-results/email-local/inbox-desktop.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page
    .getByRole('button', { name: 'Local testing controls', exact: true })
    .click()
  await drawer.getByRole('button', { name: 'Close details' }).click()
  await page.getByRole('button', { name: /^Scheduled/ }).click()
  await expect(
    page.getByRole('region', { name: 'Conversations' }),
  ).toContainText('Jamie Sample')
  await page.getByRole('button', { name: 'Details', exact: true }).click()
  await drawer.getByRole('tab', { name: 'Next step', exact: true }).click()
  // A changed conversation must invalidate a typed reply without silently replacing it.
  await page.getByRole('button', { name: 'Edit reply', exact: true }).click()
  await page
    .getByLabel('Reply draft', { exact: true })
    .fill('Would 2 PM work for a quick call?')
  await receive.click()
  await expect(
    page.getByRole('button', { name: 'Queue simulated reply', exact: true }),
  ).toBeDisabled()
  await expect(page.getByLabel('Reply draft', { exact: true })).toHaveValue(
    'Would 2 PM work for a quick call?',
  )
  await page.getByRole('button', { name: 'Edit reply', exact: true }).click()
  await page
    .getByRole('button', { name: 'Approve & queue reply', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText('Reply queued')
  await expect(
    page.getByRole('button', { name: 'Queue simulated reply', exact: true }),
  ).toBeDisabled()
  // Longer history scrolls inside the thread, leaving the composer in place.
  for (let i = 0; i < 4; i++) await receive.click()
  await page.getByRole('button', { name: /Show .* earlier messages/ }).click()
  const history = page.getByLabel('Email history', { exact: true })
  const composer = page.getByLabel('Reply composer', { exact: true })
  const before = await composer.boundingBox()
  await history.evaluate((el) => {
    el.scrollTop = 0
  })
  const after = await composer.boundingBox()
  expect(Math.abs((before?.y ?? 0) - (after?.y ?? 0))).toBeLessThan(2)
  expect(
    await history.evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true)
  await page
    .getByLabel('Practice incoming reply', { exact: true })
    .fill('Please unsubscribe me.')
  await receive.click()
  await expect(page.getByText('Unsubscribed', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Reply draft', { exact: true })).toHaveCount(0)
  await page.reload()
  await page
    .getByRole('region', { name: 'Conversations', exact: true })
    .getByRole('button')
    .first()
    .click()
  await expect(page.getByRole('region', { name: 'Next action' })).toContainText(
    'Callback held for review',
  )
  await expect(drawer).toBeVisible()
  await drawer.getByRole('tab', { name: 'Contact', exact: true }).focus()
  await page.keyboard.press('End')
  await expect(
    drawer.getByRole('tab', { name: 'Ari’s Insights', exact: true }),
  ).toBeFocused()
  await page.keyboard.press('Home')
  await expect(
    drawer.getByRole('tab', { name: 'Next step', exact: true }),
  ).toBeFocused()
  await drawer.getByRole('tab', { name: 'Notes', exact: true }).click()
  await expect(
    drawer.getByText('Seller prefers afternoon calls.', { exact: true }),
  ).toBeVisible()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'test-results/email-local/inbox-mobile.png',
    fullPage: true,
    animations: 'disabled',
  })
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
  expect(
    await page
      .getByRole('main')
      .evaluate((el) =>
        getComputedStyle(el).getPropertyValue('--accent').trim(),
      ),
  ).toBe('#a9202e')
})

test('unavailable state is visible and refresh recovers; wrong-origin writes are rejected', async ({
  page,
  request,
}) => {
  await page.route('**/api/email/workspace', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'EMAIL_UNAVAILABLE' }),
    }),
  )
  await page.goto('/')
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'could not be loaded',
  )
  await page.unroute('**/api/email/workspace')
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  await expect(
    page.getByText('Local practice workspace', { exact: true }),
  ).toBeVisible()
  const response = await request.post('/api/email/workspace', {
    headers: { Origin: 'https://unrelated.test' },
    data: { command: 'CAM-CREATE' },
  })
  expect(response.status()).toBe(403)
})

test('owner saves business and team setup; unavailable connections cannot enable sending', async ({
  page,
}) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.goto('/')
  await page.getByRole('button', { name: 'More', exact: true }).click()
  const setup = page.getByRole('region', { name: 'Email setup', exact: true })
  await page
    .getByLabel('Business name', { exact: true })
    .fill('SavingKC practice business')
  await page
    .getByLabel('Main company domain', { exact: true })
    .fill('savingkc.test')
  await page
    .getByLabel('Business mailing address', { exact: true })
    .fill('100 Sample Street, Example City')
  await page
    .getByLabel('Contact shown to readers', { exact: true })
    .fill('team@savingkc.test')
  await page
    .getByLabel('Privacy page URL', { exact: true })
    .fill('https://savingkc.test/privacy')
  await page
    .getByRole('button', { name: 'Save business details', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'Setup details saved. Sending remains disabled.',
  )
  await expect(
    setup.getByRole('button', { name: '1. Business · Saved', exact: true }),
  ).toBeVisible()
  await setup.getByRole('button', { name: /2. Team/ }).click()
  await page
    .getByRole('combobox', { name: 'Reply reviewer', exact: true })
    .selectOption({ label: 'Demo owner' })
  await page
    .getByRole('combobox', { name: 'Acquisitions owner', exact: true })
    .selectOption({ label: 'Demo agent' })
  await page
    .getByRole('combobox', { name: 'Backup agent', exact: true })
    .selectOption({ label: 'Demo owner' })
  await page
    .getByRole('button', { name: 'Save team responsibilities', exact: true })
    .click()
  await expect(
    setup.getByRole('button', { name: '2. Team · Saved', exact: true }),
  ).toBeVisible()
  await page.reload()
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await expect(page.getByLabel('Business name', { exact: true })).toHaveValue(
    'SavingKC practice business',
  )
  await setup.getByRole('button', { name: /2. Team/ }).click()
  await expect(
    page.getByRole('combobox', { name: 'Acquisitions owner', exact: true }),
  ).toHaveValue('00000000-0000-4000-8000-000000000002')
  await page.screenshot({
    path: 'test-results/email-local/setup-desktop.png',
    fullPage: true,
  })
  await setup.getByRole('button', { name: /3. Connections/ }).click()
  await expect(
    setup.getByText(
      'Secure credential storage needs configuration. Do not paste a real key into this practice workspace.',
      { exact: true },
    ),
  ).toBeVisible()
  await expect(
    setup.getByRole('button', { name: /enable|finish/i }),
  ).toHaveCount(0)
  await expect(setup.getByLabel('Resend API key')).toBeDisabled()
  await expect(
    setup.getByRole('button', { name: 'Check & save connection' }),
  ).toBeDisabled()
  await page.screenshot({
    path: 'test-results/email-local/connections-desktop.png',
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'test-results/email-local/connections-mobile.png',
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  await setup.getByRole('button', { name: /1. Business/ }).click()
  await page.screenshot({
    path: 'test-results/email-local/setup-mobile.png',
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
  expect(browserErrors).toEqual([])
})

test('mock-backed UI contract: CRM repair stays visible until an owner retry resolves it', async ({
  page,
  request,
}) => {
  const liveResponse = await request.get('/api/email/workspace')
  expect(liveResponse.ok()).toBe(true)
  const liveState = (await liveResponse.json()) as PilotState
  const repairId = '20000000-0000-4000-8000-000000000001'
  const threadId = '20000000-0000-4000-8000-000000000002'
  const campaignId = '20000000-0000-4000-8000-000000000003'
  const addressId = '20000000-0000-4000-8000-000000000004'
  const leadId = '20000000-0000-4000-8000-000000000005'
  const handoffId = '20000000-0000-4000-8000-000000000006'
  const taskId = '20000000-0000-4000-8000-000000000007'
  const failureCode = 'CRM_PROJECTION_FAILED'
  const sourceThread: PilotThread = liveState.threads[0] ?? {
    id: threadId,
    campaign_id: campaignId,
    campaign_name: 'Fabricated CRM repair contract',
    name: 'Jamie Sample',
    email: 'jamie@example.test',
    address_id: addressId,
    subject: 'Property question',
    controller: 'human',
    controller_user_id: liveState.actorId,
    responsible_user_id: liveState.actorId,
    controller_revision: 2,
    content_revision: 2,
    state: 'stopped',
    outcome: 'unsubscribed',
    last_message_at: liveState.asOf,
    lead_id: leadId,
    lead_stage: 'contacted',
    lead_classification: 'lead',
    lead_source: 'email_marketing',
    handoff_id: handoffId,
    handoff_state: 'needs_contact',
    handoff_owner_id: liveState.actorId,
    handoff_backup_id: liveState.members[0]?.id ?? liveState.actorId,
    crm_sync_state: 'synced',
    crm_sync_reason: null,
    crm_task_id: taskId,
    crm_task_key: `activity:${taskId}`,
    crm_history_repair_required: false,
    crm_callback_repair_required: false,
    crm_repair_id: null,
    crm_repair_error_code: null,
    callback_task_state: 'pending',
    callback_due_at: '2026-09-14T15:30:00.000Z',
    requested_contact: { phone: '816-555-0101' },
  }
  const damagedThread: PilotThread = {
    ...sourceThread,
    responsible_user_id: liveState.actorId,
    controller_user_id: liveState.actorId,
    state: 'stopped',
    outcome: 'unsubscribed',
    lead_id: leadId,
    lead_stage: 'contacted',
    lead_classification: 'lead',
    lead_source: 'email_marketing',
    handoff_id: handoffId,
    handoff_state: 'needs_contact',
    handoff_owner_id: liveState.actorId,
    handoff_backup_id: liveState.members[0]?.id ?? liveState.actorId,
    crm_sync_state: 'synced',
    crm_sync_reason: null,
    crm_task_id: taskId,
    crm_task_key: `activity:${taskId}`,
    crm_history_repair_required: true,
    crm_callback_repair_required: true,
    crm_repair_id: repairId,
    crm_repair_error_code: failureCode,
    callback_task_state: 'pending',
    callback_due_at: '2026-09-14T15:30:00.000Z',
    requested_contact: { phone: '816-555-0101' },
  }
  let workspaceState: PilotState = {
    ...liveState,
    roles: ['reviewer'],
    threads: [
      damagedThread,
      ...liveState.threads.filter((thread) => thread.id !== sourceThread.id),
    ],
  }
  const replayCommands: unknown[] = []

  await page.route('**/api/email/workspace*', async (route) => {
    const request = route.request()
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, json: workspaceState })
      return
    }
    if (request.method() !== 'POST') {
      await route.fallback()
      return
    }

    replayCommands.push(request.postDataJSON())
    if (replayCommands.length === 1) {
      await route.fulfill({
        status: 200,
        json: { entityId: repairId, state: 'crm_repair_pending' },
      })
      return
    }

    workspaceState = {
      ...workspaceState,
      threads: workspaceState.threads.map((thread) =>
        thread.id === damagedThread.id
          ? {
              ...thread,
              handoff_state: 'held',
              crm_history_repair_required: false,
              crm_callback_repair_required: false,
              crm_repair_id: null,
              crm_repair_error_code: null,
              callback_task_state: 'blocked',
            }
          : thread,
      ),
    }
    await route.fulfill({
      status: 200,
      json: { entityId: repairId, state: 'crm_repair_resolved' },
    })
  })

  await page.goto('/')
  const conversations = page.getByRole('region', {
    name: 'Conversations',
    exact: true,
  })
  await conversations
    .getByRole('button')
    .filter({ hasText: damagedThread.name })
    .first()
    .click()
  const selected = page.getByRole('region', {
    name: 'Next action',
    exact: true,
  })
  await expect(selected).toContainText(
    'Marketing is stopped. The callback hold has not reached CRM.',
  )
  await expect(selected.getByText(/Callback held for review/)).toHaveCount(0)
  await expect(
    selected.getByRole('button', { name: 'Retry CRM update', exact: true }),
  ).toHaveCount(0)

  workspaceState = { ...workspaceState, roles: ['owner'] }
  await page.getByRole('button', { name: 'Refresh', exact: true }).click()
  const retryButton = selected.getByRole('button', {
    name: 'Retry CRM update',
    exact: true,
  })
  await expect(retryButton).toBeVisible()
  await retryButton.click()
  await expect(page.getByRole('status')).toContainText(
    'CRM still needs repair. The pending update is saved',
  )
  await expect(selected).toContainText('Resolve issue')
  await expect(retryButton).toBeVisible()
  expect(replayCommands).toHaveLength(1)
  expect(replayCommands[0]).toMatchObject({
    command: 'OPS-REPLAY',
    payload: {
      jobId: repairId,
      expectedFailureCode: failureCode,
      reason: 'Owner reviewed the pending CRM update and requested a retry.',
    },
  })

  await retryButton.click()
  await expect(page.getByRole('status')).toContainText(
    'CRM history and callback updates are current.',
  )
  await expect(retryButton).toHaveCount(0)
  await expect(selected).not.toContainText(
    'The callback hold has not reached CRM',
  )
  await expect(selected.getByText(/Callback held for review/)).toBeVisible()
  await expect(selected).toContainText(
    'Callback held for review. Resolve the hold before calling.',
  )
  expect(replayCommands).toHaveLength(2)

  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})

test('mock-backed connection UI clears the key and makes disconnect impact explicit', async ({
  page,
}) => {
  const connectionId = '00000000-0000-4000-8000-000000000098'
  const state = {
    configured: true,
    revision: 0,
    ai: { configured: false, lastState: null, failureCode: null },
    disconnectImpact: {
      hash: 'a'.repeat(64),
      activeCampaigns: 2,
      queuedMessages: 3,
    },
    connections: [] as Record<string, unknown>[],
  }
  let submissions = 0,
    disconnects = 0
  await page.route('**/api/email/connections', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      submissions++
      expect(request.postDataJSON().secret).toBe(
        're_fixture_browser_private_123456',
      )
      await expect(page.getByLabel('Resend API key')).toHaveValue('')
      state.connections = [
        {
          id: connectionId,
          provider: 'resend',
          account_label: 'Fixture account',
          masked_secret: 're_f••••3456',
          state: 'checked',
          failure_code: null,
          checked_at: '2026-09-14T15:00:00Z',
        },
      ]
      await route.fulfill({ json: { ...state, connectionId } })
      return
    }
    if (request.method() === 'DELETE') {
      disconnects++
      expect(request.postDataJSON()).toMatchObject({
        connectionId,
        confirmedAffectedHash: state.disconnectImpact.hash,
        reason: 'Replace fixture key',
      })
      state.connections[0].state = 'revoked'
      state.revision++
    }
    await route.fulfill({ json: state })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: /3. Connections/ }).click()
  await page.getByLabel('Account label').fill('Fixture account')
  await page
    .getByLabel('Resend API key')
    .fill('re_fixture_browser_private_123456')
  await page
    .getByRole('button', { name: 'Check & save connection', exact: true })
    .click()
  await expect(
    page.getByText(
      'Read access checked. Sender setup and delivery checks are still required.',
      { exact: true },
    ),
  ).toBeVisible()
  expect(submissions).toBe(1)
  expect(await page.locator('body').innerText()).not.toContain(
    're_fixture_browser_private_123456',
  )
  await page.getByText('Disconnect', { exact: true }).click()
  await expect(
    page.getByText(/2 active campaigns and 3 queued messages/),
  ).toBeVisible()
  await page.getByLabel('Reason', { exact: true }).fill('Replace fixture key')
  await page
    .getByRole('button', { name: 'Disconnect & pause email', exact: true })
    .click()
  await expect(
    page.getByText(
      'Disconnected locally. Email work is paused. Existing conversation history is preserved.',
      { exact: true },
    ),
  ).toBeVisible()
  expect(disconnects).toBe(1)
  await expect(
    page.getByRole('button', { name: 'Disconnect & pause email', exact: true }),
  ).toHaveCount(0)
})

test('mock-backed sender setup rejects the main domain and shows provider DNS without enabling sending', async ({
  page,
}) => {
  const connectionId = '00000000-0000-4000-8000-000000000091',
    domainId = '00000000-0000-4000-8000-000000000092',
    senderId = '00000000-0000-4000-8000-000000000093'
  const state = {
    configured: true,
    revision: 0,
    primaryDomain: 'savingkc.com',
    connections: [{ id: connectionId, account_label: 'Fixture Resend' }],
    domains: [] as Record<string, unknown>[],
    senders: [] as Record<string, unknown>[],
  }
  await page.route('**/api/email/domains', async (route) => {
    if (route.request().method() === 'POST') {
      const command = route.request().postDataJSON()
      if (command.command === 'DOM-ADD') {
        if (command.payload.domain === 'mail.savingkc.com') {
          await route.fulfill({
            status: 400,
            json: { error: { code: 'PRIMARY_DOMAIN_OR_SUBDOMAIN_FORBIDDEN' } },
          })
          return
        }
        expect(command.payload).toMatchObject({
          domain: 'savingkc-outreach.com',
          connectionId,
          brandUrl: 'https://savingkc-outreach.com',
        })
        state.domains = [
          {
            id: domainId,
            name: 'savingkc-outreach.com',
            state: 'needs_dns',
            connection_state: 'checked',
            sending_state: 'enabled',
            receiving_state: 'enabled',
            paused: true,
            revision: 1,
            brand_url: 'https://savingkc-outreach.com',
            failure_code: null,
            dns_records: [
              {
                record: 'DKIM',
                type: 'TXT',
                name: 'resend._domainkey',
                value: 'fixture-provider-dkim',
                status: 'not_started',
              },
            ],
          },
        ]
        await route.fulfill({ json: { ...state, entityId: domainId } })
        return
      }
      if (command.command === 'SND-SAVE') {
        expect(command.payload.state).toBe('paused')
        state.senders = [
          {
            id: senderId,
            domain_id: domainId,
            from_name: command.payload.fromName,
            local_part: command.payload.localPart,
            signature: command.payload.signature,
            hourly_limit: 5,
            daily_limit: 20,
            state: 'paused',
            revision: 0,
          },
        ]
        await route.fulfill({ json: { ...state, entityId: senderId } })
        return
      }
    }
    await route.fulfill({ json: state })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await page.getByRole('button', { name: /3. Connections/ }).click()
  const section = page.getByRole('region', {
    name: 'Sender domains',
    exact: true,
  })
  await section.getByText('Add an owned domain', { exact: true }).click()
  await section
    .getByLabel('Owned outreach domain', { exact: true })
    .fill('mail.savingkc.com')
  await section
    .getByLabel('Brand page on this domain', { exact: true })
    .fill('https://savingkc-outreach.com')
  await section
    .getByLabel(
      'I own this domain and want to set up sending and receiving in Resend.',
    )
    .check()
  await section
    .getByRole('button', { name: 'Set up owned domain', exact: true })
    .click()
  await expect(section).toContainText(
    'The main company domain and its subdomains are blocked.',
  )
  await section
    .getByLabel('Owned outreach domain', { exact: true })
    .fill('savingkc-outreach.com')
  await section
    .getByRole('button', { name: 'Set up owned domain', exact: true })
    .click()
  await expect(section).toContainText('DNS setup needed · Sending paused')
  await section.getByText('DNS & next steps', { exact: true }).click()
  await expect(
    section.getByText('fixture-provider-dkim', { exact: true }),
  ).toBeVisible()
  await section.getByText('Add sender', { exact: true }).click()
  await section
    .getByRole('button', { name: 'Save sender', exact: true })
    .click()
  await expect(section).toContainText('hello@savingkc-outreach.com · paused')
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'test-results/email-local/senders-mobile.png',
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true)
})

test('receiving operations explains identity holds without exposing a live provider action in practice',async({page})=>{
  await page.route('**/api/email/receiving',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({total:1,jobs:[{id:'11111111-1111-4111-8111-111111111111',kind:'resend_receive_content',state:'dead',attempts:1,run_after:'2026-09-14T15:00:00Z',lease_until:null,last_error:'REPLY_IDENTITY_REVIEW',hold_reason:'REPLY_IDENTITY_REVIEW',can_retry:false}]})}))
  await page.goto('/')
  await page.getByRole('button',{name:'More',exact:true}).click()
  const receiving=page.getByRole('region',{name:'Receiving replies',exact:true})
  await expect(receiving).toContainText('Sender or conversation match needs review.')
  await expect(receiving).toContainText('Practice workspace. Live receiving is not connected.')
  await expect(receiving.getByRole('button',{name:'Retry retrieval'})).toHaveCount(0)
  await expect(receiving.getByRole('button',{name:'Retrieve next reply'})).toHaveCount(0)
  await page.screenshot({path:'test-results/email-local/receiving-operations.png',fullPage:true,animations:'disabled'})
})
