import { test, expect } from '@playwright/test'
import type {
  PilotState,
  PilotThread,
} from '../../src/lib/email/workflow/types'

test('campaign → review → simulated acceptance → reply → takeover → callback → opt-out survives reload', async ({
  page,
}) => {
  const browserErrors: string[] = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.goto('/')
  await expect(
    page.getByText('Local practice workspace', { exact: true }),
  ).toBeVisible()
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
  await expect(
    page.getByText('Address verification required', { exact: true }),
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
  await expect(page.getByRole('status')).toHaveText(
    'One message accepted by the simulated transport.',
  )
  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await page.getByRole('button', { name: /All conversations/ }).click()
  await page
    .getByRole('region', { name: 'Conversations', exact: true })
    .getByRole('button')
    .first()
    .click()
  await page
    .getByRole('button', {
      name: 'Receive practice reply in selected conversation',
      exact: true,
    })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'Pending sequence messages are stopped',
  )
  const messageCards = page
    .getByRole('region', { name: 'Selected conversation' })
    .locator('article')
  await expect(messageCards.nth(0)).toContainText('SavingKC · simulated')
  await expect(messageCards.nth(1)).toContainText('I might consider selling')
  await page.getByRole('button', { name: 'Take over', exact: true }).click()
  await page
    .getByLabel('Reply draft', { exact: true })
    .fill('Would 2 PM work for a quick call?')
  await page
    .getByRole('button', { name: 'Save reply draft', exact: true })
    .click()
  await expect(
    page.getByRole('button', { name: 'Queue simulated reply', exact: true }),
  ).toBeEnabled()
  // A later inbound must invalidate the saved reply through the actual API.
  await page
    .getByRole('button', {
      name: 'Receive practice reply in selected conversation',
      exact: true,
    })
    .click()
  await expect(
    page.getByRole('button', { name: 'Queue simulated reply', exact: true }),
  ).toHaveCount(0)
  await page
    .getByRole('button', { name: 'Arrange callback', exact: true })
    .click()
  await page
    .getByLabel('Phone from this reply', { exact: true })
    .fill('816-555-0101')
  await page
    .getByLabel('Seller’s exact time wording', { exact: true })
    .fill('Tomorrow afternoon')
  await page.getByRole('checkbox', { name: /I read the current reply/ }).check()
  await page
    .getByLabel('Practice incoming reply', { exact: true })
    .fill(
      'I would consider selling. Call me at 816-555-0101. Tomorrow afternoon works.',
    )
  await page
    .getByRole('button', {
      name: 'Receive practice reply in selected conversation',
      exact: true,
    })
    .click()
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'A new reply arrived. Read the latest message, then reset this review before saving the handoff.',
  )
  await expect(
    page.getByRole('checkbox', { name: /I read the current reply/ }),
  ).not.toBeChecked()
  await expect(
    page.getByRole('button', { name: 'Save callback handoff', exact: true }),
  ).toBeDisabled()
  await expect(
    page.getByLabel('Phone from this reply', { exact: true }),
  ).toHaveValue('816-555-0101')
  await expect(
    page.getByLabel('Seller’s exact time wording', { exact: true }),
  ).toHaveValue('Tomorrow afternoon')
  await page
    .getByRole('button', { name: 'Review latest reply', exact: true })
    .click()
  await expect(
    page.getByRole('checkbox', { name: /I read the current reply/ }),
  ).not.toBeChecked()
  await expect(
    page.getByRole('button', { name: 'Save callback handoff', exact: true }),
  ).toBeEnabled()
  await page.getByRole('checkbox', { name: /I read the current reply/ }).check()
  await page
    .getByRole('button', { name: 'Save callback handoff', exact: true })
    .click()
  await expect(page.getByRole('status')).toContainText(
    'The Lead and callback review task are linked',
  )
  await expect(
    page.getByText('Lead · Contacted', { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText('Review callback by', { exact: true }),
  ).toBeVisible()
  await page.screenshot({
    path: 'test-results/email-local/inbox-desktop.png',
    fullPage: true,
  })
  await page.getByRole('button', { name: 'More', exact: true }).click()
  await expect(
    page.getByText('Callback task ready', { exact: true }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: 'Acknowledge', exact: true })
    .first()
    .click()
  await expect(page.getByText('Acknowledged', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Inbox', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Inbox', exact: true }),
  ).toBeVisible()
  if (
    !(await page
      .getByLabel('Practice incoming reply', { exact: true })
      .isVisible())
  )
    await page.getByText('Local testing controls', { exact: true }).click()
  await page
    .getByLabel('Practice incoming reply', { exact: true })
    .fill('Please unsubscribe me.')
  await page
    .getByRole('button', {
      name: 'Receive practice reply in selected conversation',
      exact: true,
    })
    .click()
  await expect(page.getByText('Unsubscribed', { exact: true })).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Save reply draft', exact: true }),
  ).toHaveCount(0)
  await page.reload()
  await page.getByRole('button', { name: /Closed & stopped/ }).click()
  await page
    .getByRole('region', { name: 'Conversations', exact: true })
    .getByRole('button')
    .click()
  await expect(page.getByText('Unsubscribed', { exact: true })).toBeVisible()
  await expect(
    page.getByText('Callback held for review', {
      exact: true,
    }),
  ).toBeVisible()
  await page.getByRole('button', { name: /Needs action/ }).click()
  await expect(
    page
      .getByRole('region', { name: 'Conversations', exact: true })
      .getByRole('button'),
  ).toHaveCount(1)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: 'test-results/email-local/inbox-mobile.png',
    fullPage: true,
  })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
  expect(browserErrors).toEqual([])
  const theme = await page.getByRole('main').evaluate((el) => ({
    accent: getComputedStyle(el).getPropertyValue('--accent').trim(),
    background: getComputedStyle(el).backgroundColor,
  }))
  expect(theme.accent).toBe('#a9202e')
  expect(theme.background).toBe('rgb(246, 247, 249)')
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
    setup.getByText('Sending disabled.', { exact: true }),
  ).toBeVisible()
  await expect(
    setup.getByRole('button', { name: /enable|finish/i }),
  ).toHaveCount(0)
  await page.setViewportSize({ width: 390, height: 844 })
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
    name: 'Selected conversation',
    exact: true,
  })
  await expect(selected).toContainText(
    'Marketing is stopped. The callback hold has not reached CRM.',
  )
  await expect(
    selected.getByText('Callback held for review', { exact: true }),
  ).toHaveCount(0)
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
  await expect(selected).toContainText('CRM update needs attention')
  await expect(retryButton).toBeVisible()
  expect(replayCommands).toHaveLength(1)
  expect(replayCommands[0]).toMatchObject({
    command: 'OPS-REPLAY',
    payload: {
      jobId: repairId,
      expectedFailureCode: failureCode,
      reason:
        'Owner reviewed the pending CRM update and requested a retry.',
    },
  })

  await retryButton.click()
  await expect(page.getByRole('status')).toContainText(
    'CRM history and callback updates are current.',
  )
  await expect(retryButton).toHaveCount(0)
  await expect(selected).not.toContainText('CRM update needs attention')
  await expect(
    selected.getByText('Callback held for review', { exact: true }),
  ).toBeVisible()
  await expect(selected).toContainText(
    'Marketing was stopped, so the linked callback task is blocked',
  )
  expect(replayCommands).toHaveLength(2)

  await page.setViewportSize({ width: 390, height: 844 })
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true)
})
