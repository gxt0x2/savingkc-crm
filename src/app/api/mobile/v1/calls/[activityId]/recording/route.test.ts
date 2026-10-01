import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ user: vi.fn(), lead: vi.fn(), admin: vi.fn(), fetch: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.user,
}))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(), requireAuthorizedMobileLead: mocks.lead,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { GET } from './route'
import { MobileAuthError } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError } from '@/lib/mobile-api/authorized-lead'

const id = '11111111-1111-4111-8111-111111111111'
const leadId = '22222222-2222-4222-8222-222222222222'
const sid = `RE${'c'.repeat(32)}`
const account = `AC${'a'.repeat(32)}`
const context = { params: Promise.resolve({ activityId: id }) }
function request() {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/calls/${id}/recording`, {
    headers: { Authorization: 'Bearer user', Range: 'bytes=0-99' },
  })
}

describe('bearer-scoped Twilio recording playback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.TWILIO_ACCOUNT_SID = account
    process.env.TWILIO_AUTH_TOKEN = 'test-secret'
    mocks.user.mockResolvedValue({ user: { email: 'casey@savingkc.com' } })
    mocks.lead.mockResolvedValue({ lead: { id: leadId } })
    mocks.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { id, lead_id: leadId, activity_type: 'voicemail', metadata: { recordingSid: sid } }, error: null,
    }) }) }) }) })
    mocks.fetch.mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), { status: 206, headers: { 'content-type': 'audio/mpeg', 'content-range': 'bytes 0-2/3' } }))
    vi.stubGlobal('fetch', mocks.fetch)
  })

  afterEach(() => {
    delete process.env.TWILIO_ACCOUNT_SID
    delete process.env.TWILIO_AUTH_TOKEN
    vi.unstubAllGlobals()
  })

  it('checks bearer and linked lead scope before fetching the allowed provider URL', async () => {
    const response = await GET(request(), context)
    expect(response.status).toBe(206)
    expect(response.headers.get('content-type')).toBe('audio/mpeg')
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.lead).toHaveBeenCalledWith(expect.anything(), leadId)
    expect(mocks.fetch.mock.calls[0][0]).toBe(`https://api.twilio.com/2010-04-01/Accounts/${account}/Recordings/${sid}.mp3`)
    const init = mocks.fetch.mock.calls[0][1] as { headers: Headers }
    expect(init.headers.get('Range')).toBe('bytes=0-99')
    expect(init.headers.get('Authorization')).toMatch(/^Basic /)
  })

  it('does not read storage for an unauthenticated request', async () => {
    mocks.user.mockRejectedValue(new MobileAuthError('Invalid bearer token'))
    const response = await GET(request(), context)
    expect(response.status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('does not fetch provider audio when the lead is outside actor scope', async () => {
    mocks.lead.mockRejectedValue(new MobileLeadAccessError('outside scope', 403))
    const response = await GET(request(), context)
    expect(response.status).toBe(403)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it('never fetches an arbitrary stored recording URL', async () => {
    mocks.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({
      data: { id, lead_id: leadId, activity_type: 'voicemail', metadata: { recording_url: 'https://evil.example/audio.mp3' } }, error: null,
    }) }) }) }) })
    const response = await GET(request(), context)
    expect(response.status).toBe(404)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
