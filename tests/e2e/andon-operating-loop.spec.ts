import { expect, test, type Page } from '@playwright/test'

test.use({
  extraHTTPHeaders: {
    'x-skc-test-auth-bypass': 'playwright-smoke-bypass',
  },
  viewport: { width: 1600, height: 1000 },
})

type AndonFixture = {
  id: string
  type: string
  issue_kind: 'process' | 'system' | 'data' | 'improvement' | 'ai_glitch'
  department: string
  category: string
  description: string
  five_whys: string[]
  priority: string
  status: string
  created_at: string
  updated_at: string | null
  resolved_at: string | null
  record_id: string | null
  record_type: 'lead' | 'property' | null
  record_url: string | null
  assignee: string | null
  estimated_resolution_at: string | null
  agent_name: string
  page_url: string
  source: 'feedback'
}

function activeAndon(overrides: Partial<AndonFixture> = {}): AndonFixture {
  return {
    id: 'andon-1',
    type: 'bug',
    issue_kind: 'ai_glitch',
    department: 'Acquisitions',
    category: 'AI Text Bot Sequence',
    description: 'The AI sent a reply that did not match the seller question.',
    five_whys: ['', '', '', '', ''],
    priority: 'critical',
    status: 'open',
    created_at: '2026-08-10T14:00:00.000Z',
    updated_at: null,
    resolved_at: null,
    record_id: 'lead-123',
    record_type: 'lead',
    record_url: 'https://crm.savingkc.com/leads/lead-123',
    assignee: null,
    estimated_resolution_at: null,
    agent_name: 'Ernest',
    page_url: 'https://crm.savingkc.com/leads/lead-123',
    source: 'feedback',
    ...overrides,
  }
}

async function mockWorkspace(page: Page) {
  await page.route('**/api/conversations/hub**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })
}

async function fulfillAndonLog(page: Page, items: AndonFixture[]) {
  await page.route('**/api/feedback/log**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ items, total: items.length, warnings: [], storage_ready: true, automatic_error_log_ready: true }),
    })
  })
}

test('Andon intake routes AI glitches and captures the exact lead context', async ({ page }) => {
  await mockWorkspace(page)
  await fulfillAndonLog(page, [])
  let submission: Record<string, unknown> | null = null
  await page.route('**/api/feedback/submit', async (route) => {
    submission = route.request().postDataJSON() as Record<string, unknown>
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, feedback_id: 'andon-new' }) })
  })

  await page.goto('/reports/andon?lead_id=lead-123', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Raise an Andon and report an issue' }).click()
  const intake = page.getByRole('dialog', { name: 'Report an issue' })
  await intake.getByRole('button', { name: 'AI Glitch' }).click()

  const workArea = page.getByRole('combobox', { name: 'Core work area' })
  const process = page.getByRole('combobox', { name: 'Specific process' })
  await workArea.selectOption('Marketing')
  await expect(process.locator('option')).toHaveText(['Skip Tracing Sync', 'PPC Landing Page', 'List Import Error'])
  await workArea.selectOption('Acquisitions')
  await expect(process.locator('option')).toHaveText(['AI Text Bot Sequence', 'Cold Dialer Lag', 'Callback Automation'])
  await workArea.selectOption('Dispositions')
  await expect(process.locator('option')).toHaveText(['Cash Buyer Email Blast', 'VIP List Tagging', 'SMS Blast Blocked'])
  await workArea.selectOption('Transaction Coordination')
  await expect(process.locator('option')).toHaveText(['Title Company Hand-off', 'EMD Tracking', 'Inspection Period Bug'])
  await workArea.selectOption('Acquisitions')
  await process.selectOption('AI Text Bot Sequence')
  await page.getByRole('textbox', { name: 'What happened' }).fill('ARI sent a reply intended for another seller.')
  await page.getByRole('button', { name: 'Raise Andon' }).click()

  await expect.poll(() => submission).not.toBeNull()
  expect(submission).toMatchObject({
    issue_kind: 'ai_glitch',
    department: 'Acquisitions',
    category: 'AI Text Bot Sequence',
    record_id: 'lead-123',
    record_type: 'lead',
    record_url: expect.stringContaining('/leads/lead-123'),
  })
})

test('resolving an Andon clears it from the active operating queue', async ({ page }) => {
  await mockWorkspace(page)
  let issue = activeAndon()
  await page.route('**/api/feedback/log**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [issue], total: 1, warnings: [], storage_ready: true }) })
  })
  let update: Record<string, unknown> | null = null
  await page.route('**/api/feedback/update-status', async (route) => {
    update = route.request().postDataJSON() as Record<string, unknown>
    issue = activeAndon({
      status: String(update.status),
      assignee: String(update.assignee),
      estimated_resolution_at: '2026-08-12T00:00:00.000Z',
      five_whys: update.five_whys as string[],
      resolved_at: '2026-08-10T15:00:00.000Z',
    })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })

  await page.goto('/reports/andon', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Review' }).click()
  await page.getByRole('combobox', { name: 'Andon assignee' }).fill('Developer')
  await page.getByRole('textbox', { name: 'Estimated resolution date' }).fill('2026-08-12')
  for (let index = 1; index <= 5; index += 1) {
    await page.getByRole('textbox', { name: `Why ${index}` }).fill(`Verified root-cause answer ${index}`)
  }
  await page.getByRole('button', { name: 'Resolve and clear from active queue' }).click()

  await expect(page.getByText('No active Andons')).toBeVisible()
  expect(update).toMatchObject({
    id: 'andon-1',
    status: 'resolved',
    assignee: 'Developer',
    estimated_resolution_at: '2026-08-12',
    five_whys: [
      'Verified root-cause answer 1',
      'Verified root-cause answer 2',
      'Verified root-cause answer 3',
      'Verified root-cause answer 4',
      'Verified root-cause answer 5',
    ],
  })
})

test('resolved history keeps record links, ownership, target date, and can reopen an issue', async ({ page }) => {
  await mockWorkspace(page)
  let issue = activeAndon({
    status: 'resolved',
    resolved_at: '2026-08-10T15:00:00.000Z',
    assignee: 'Operations manager',
    estimated_resolution_at: '2026-08-12T00:00:00.000Z',
    five_whys: ['Bad response', 'Bad context', 'Wrong lead', 'Missing guard', 'Missing test'],
  })
  await page.route('**/api/feedback/log**', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [issue], total: 1, warnings: [], storage_ready: true }) })
  })
  await page.route('**/api/feedback/update-status', async (route) => {
    const update = route.request().postDataJSON() as Record<string, unknown>
    issue = activeAndon({ ...issue, status: String(update.status), resolved_at: null })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
  })

  await page.goto('/reports/andon', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Resolved \/ closed/ }).click()
  await expect(page.getByRole('cell', { name: 'Operations manager' })).toBeVisible()
  await expect(page.locator('a[href="https://crm.savingkc.com/leads/lead-123"]')).toBeVisible()
  await expect(page.getByText('resolved', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Review' }).click()
  await page.getByRole('button', { name: 'Reopen issue' }).click()
  await page.getByRole('button', { name: /Active queue/ }).click()
  await expect(page.getByText('The AI sent a reply that did not match the seller question.')).toBeVisible()
  await expect(page.getByText('open', { exact: true })).toBeVisible()
})
