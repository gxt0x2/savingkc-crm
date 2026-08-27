import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUserEmail: vi.fn(),
  supabaseAdmin: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))

vi.mock('@/lib/call-review-ai', () => ({
  processCallReviewAi: vi.fn(),
}))

vi.mock('@/lib/server/operational-sms-alerts', () => ({
  sendCallReviewSubmittedSmsAlert: vi.fn(),
}))

import { PATCH } from './route'

function request(action: 'submit' | 'complete' | 'retry_ai' | 'reopen', values: Record<string, unknown> = {}) {
  return new NextRequest('https://crm.savingkc.com/api/marketing/call-recordings', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ activityId: 'call-42', action, ...values }),
  })
}

describe('call review mutation access', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUserEmail.mockResolvedValue('casey@savingkc.com')
  })

  it.each(['complete', 'retry_ai', 'reopen'] as const)('denies Casey before database work for %s', async (action) => {
    const response = await PATCH(request(action))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'Call review access is restricted to assigned reviewers' })
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled()
  })

  it('rejects an overlong submitter note before database work', async () => {
    const response = await PATCH(request('submit', { note: 'x'.repeat(501) }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Note to reviewer must be 500 characters or fewer' })
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled()
  })
})
