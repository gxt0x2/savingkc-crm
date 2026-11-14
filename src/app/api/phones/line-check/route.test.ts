import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  email: vi.fn(),
  admin: vi.fn(),
  run: vi.fn(),
  client: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.email,
  isUserAdmin: mocks.admin,
}))
vi.mock('@/lib/server/phone-line-check', () => ({ runPhoneLineChecks: mocks.run }))
vi.mock('@/lib/server/phone-line-check-store', () => ({ phoneLineCheckStore: () => ({}) }))
vi.mock('@/lib/server/phone-line-lookup', () => ({
  createTwilioLookupClient: mocks.client,
  lookupPhoneLine: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))

import { POST } from './route'

const PHONE_ID = '11111111-1111-4111-8111-111111111111'
const LIST_ID = '22222222-2222-4222-8222-222222222222'

describe('POST /api/phones/line-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.email.mockResolvedValue('casey@savingkc.com')
    mocks.admin.mockResolvedValue(true)
    mocks.client.mockReturnValue({ lookups: {} })
    mocks.run.mockResolvedValue({ ok: true, source: 'manual', checked: 1, failed: 0, skipped: [], stopped: false, cap: null, costUsd: 0.015, remaining: 999 })
  })

  it('requires a signed-in admin and ignores a bearer secret', async () => {
    mocks.admin.mockResolvedValue(false)
    const response = await POST(new Request('https://crm.savingkc.com/api/phones/line-check', {
      method: 'POST',
      headers: { authorization: 'Bearer trusted-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ prospectPhoneIds: [PHONE_ID] }),
    }))
    expect(response.status).toBe(401)
    expect(mocks.client).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('runs a phone-id backfill as the signed-in admin', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/phones/line-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prospectPhoneIds: [PHONE_ID] }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      source: 'manual',
      actor: 'casey@savingkc.com',
      prospectPhoneIds: [PHONE_ID],
      sourceListId: null,
    }))
  })

  it('runs a source-list backfill and rejects both selectors together', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/phones/line-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceListId: LIST_ID }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ sourceListId: LIST_ID, prospectPhoneIds: null }))

    const both = await POST(new Request('https://crm.savingkc.com/api/phones/line-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceListId: LIST_ID, prospectPhoneIds: [PHONE_ID] }),
    }))
    expect(both.status).toBe(400)
  })
})
