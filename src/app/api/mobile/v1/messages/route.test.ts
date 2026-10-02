import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), admin: vi.fn(), sms: vi.fn() }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(), requireAuthorizedMobileLead: mocks.authorize }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/send-lead-sms', () => ({ sendLeadSms: mocks.sms }))
import { POST } from './route'

describe('mobile message scope', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects an out-of-scope lead before provider send or CRM read', async () => {
    const { MobileLeadAccessError } = await import('@/lib/mobile-api/authorized-lead')
    mocks.authorize.mockRejectedValue(new MobileLeadAccessError('outside scope', 403))
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/messages', {
      method: 'POST', body: JSON.stringify({ leadId: 'lead-1', channel: 'sms', body: 'Hello' }),
    }))
    expect(response.status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.sms).not.toHaveBeenCalled()
  })

  it('uses the verified actor label after lead authorization', async () => {
    mocks.authorize.mockResolvedValue({ actor: { email: 'casey@savingkc.com', fullName: 'Casey' } })
    mocks.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: 'lead-1', phone: '+18165550123' }, error: null }) }) }) }) })
    mocks.sms.mockResolvedValue({ status: 'sent', persisted: true, deliveryState: 'accepted' })
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/messages', {
      method: 'POST', body: JSON.stringify({ leadId: 'lead-1', channel: 'sms', body: 'Hello' }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.sms).toHaveBeenCalledWith(expect.objectContaining({ leadId: 'lead-1', agent: 'Casey' }))
  })
})
