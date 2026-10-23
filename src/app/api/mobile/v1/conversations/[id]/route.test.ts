import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(), requireAuthorizedMobileLead: mocks.authorize }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
import { GET } from './route'

const id = '11111111-1111-4111-8111-111111111111'
const request = () => new NextRequest(`https://crm.savingkc.com/api/mobile/v1/conversations/${id}`)
const row = (rowId: string, metadata: Record<string, unknown> = {}, kind = 'sms') => ({ id: rowId, activity_type: kind, description: rowId, agent: 'System', metadata, created_at: '2026-10-02T12:00:00.123900+00:00' })
let rows: ReturnType<typeof row>[]
let activityOffset: number
let cursorFilters: string[]

describe('mobile customer conversation history', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rows = []
    activityOffset = 0
    cursorFilters = []
    mocks.authorize.mockResolvedValue({ actor: { email: 'ernest@savingkc.com' } })
    mocks.admin.mockReturnValue({ from: (table: string) => {
      if (table === 'leads') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id, full_name: 'Seller' }, error: null }) }) }) }
      const query = { select: () => query, eq: () => query, in: () => query, order: () => query,
        or: (filter: string) => { cursorFilters.push(filter); return query },
        limit: async (limit: number) => { const data = rows.slice(activityOffset, activityOffset + limit); activityOffset += data.length; return { data, error: null } },
      }
      return query
    } })
  })

  it('returns real inbound/outbound messages and notes while excluding operational alerts', async () => {
    rows = [row('internal', { direction: 'outbound_alert', to_agents: ['Ernest'] }), row('seller-reply', { direction: 'received' }), row('seller-send', { direction: 'outbound' }), row('private-note', {}, 'note'), row('agent-claim', { outcome: 'agent_claimed' }, 'call')]
    const response = await GET(request(), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.activities.map((activity: { id: string }) => activity.id)).toEqual(['seller-reply', 'seller-send', 'private-note'])
  })

  it('pages beyond 100 newer internal alerts to retain the real seller reply', async () => {
    rows = [...Array.from({ length: 100 }, (_, index) => row(`alert-${index}`, { direction: 'outbound_alert' })), row('older-seller-reply', { direction: 'inbound' })]
    const body = await (await GET(request(), { params: Promise.resolve({ id }) })).json()
    expect(body.activities.map((activity: { id: string }) => activity.id)).toEqual(['older-seller-reply'])
    expect(cursorFilters).toEqual(['created_at.lt."2026-10-02T12:00:00.123900+00:00",and(created_at.eq."2026-10-02T12:00:00.123900+00:00",id.lt."alert-99")'])
  })

  it('does not read activities when canonical lead authorization fails', async () => {
    const { MobileLeadAccessError } = await import('@/lib/mobile-api/authorized-lead')
    mocks.authorize.mockRejectedValue(new MobileLeadAccessError('Forbidden', 403))
    expect((await GET(request(), { params: Promise.resolve({ id }) })).status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('returns secure recording hydration and canonical direction instead of a separate missed callback', async () => {
    const recordingId = 'e09b21e0-6b04-58f1-a6a3-86869d22ca12'
    const sid = `RE${'a'.repeat(32)}`
    rows = [
      row(recordingId, { source: 'twilio_recording_callback', direction: 'inbound', parentCallSid: 'CA-owned', recordingUrl: `/api/recordings/${sid}`, recordingSourceUrl: 'https://provider.invalid/file.mp3', recordingSid: sid }, 'call'),
      row('completed', { source: 'twilio_status_callback', direction: 'outbound', status: 'completed', callSid: 'CA-owned', to: '+19135550123' }, 'call'),
    ]
    const body = await (await GET(request(), { params: Promise.resolve({ id }) })).json()
    expect(body.activities).toHaveLength(1)
    expect(body.activities[0]).toMatchObject({ id: 'completed', metadata: { direction: 'outbound', outcome: 'answered', recordingUrl: `/api/mobile/v1/calls/${recordingId}/recording` } })
    expect(JSON.stringify(body.activities)).not.toContain('provider.invalid')
    expect(JSON.stringify(body.activities)).not.toContain('/api/recordings/')
  })

  it('reports an explicit email clear on the conversation contact', async () => {
    mocks.admin.mockReturnValue({ from: (table: string) => {
      if (table === 'leads') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
        data: { id, full_name: 'Ernest Dodson', email: 'savingkc@gmail.com' }, error: null,
      }) }) }) }
      if (table.startsWith('em_')) return { select: () => ({ in: async () => ({ data: [], error: null }) }) }
      const query = { select: () => query, eq: () => query, in: () => query, order: () => query, or: () => query,
        limit: async () => ({ data: [], error: null }) }
      return query
    } })
    const body = await (await GET(request(), { params: Promise.resolve({ id }) })).json()
    expect(body.contact).toMatchObject({
      email: 'savingkc@gmail.com',
      email_opt_out: false,
      email_suppressed: false,
      email_consent: 'clear',
    })
  })

  it('adds stored email body fields to email activities and leaves the description unchanged', async () => {
    const email = row('email-1', { gmail_message_id: 'gmail-1', direction: 'inbound', subject: 'Re: Oak' }, 'email_received')
    email.description = 'Call me after 5.'
    rows = [email, row('sms-1', { direction: 'received', gmail_message_id: 'not-email' })]
    mocks.admin.mockReturnValue({ from: (table: string) => {
      if (table === 'leads') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id, full_name: 'Seller' }, error: null }) }) }) }
      if (table === 'lead_emails') {
        const query = { select: () => query, eq: () => query, in: () => query, limit: async () => ({ data: [{ gmail_message_id: 'gmail-1', body_text: 'Call me after 5.\n\nThursday works.', body_snippet: 'Call me after 5.' }], error: null }) }
        return query
      }
      const query = { select: () => query, eq: () => query, in: () => query, order: () => query, or: () => query, limit: async () => ({ data: rows, error: null }) }
      return query
    } })
    const body = await (await GET(request(), { params: Promise.resolve({ id }) })).json()
    const emailActivity = body.activities.find((activity: { id: string }) => activity.id === 'email-1')
    const sms = body.activities.find((activity: { id: string }) => activity.id === 'sms-1')
    expect(emailActivity.description).toBe('Call me after 5.')
    expect(emailActivity.metadata).toMatchObject({
      gmail_message_id: 'gmail-1',
      direction: 'inbound',
      body_text: 'Call me after 5.\n\nThursday works.',
      body_snippet: 'Call me after 5.',
    })
    expect(sms.metadata.body_text).toBeUndefined()
    expect(sms.metadata.body_snippet).toBeUndefined()
  })

  it('returns the conversation when the email body column is not available yet', async () => {
    rows = [row('email-1', { gmail_message_id: 'gmail-1', direction: 'inbound' }, 'email_received')]
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.admin.mockReturnValue({ from: (table: string) => {
      if (table === 'leads') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id, full_name: 'Seller' }, error: null }) }) }) }
      if (table === 'lead_emails') {
        const query = { select: () => query, eq: () => query, in: () => query, limit: async () => ({ data: null, error: { message: 'column body_text does not exist' } }) }
        return query
      }
      const query = { select: () => query, eq: () => query, in: () => query, order: () => query, or: () => query, limit: async () => ({ data: rows, error: null }) }
      return query
    } })
    const response = await GET(request(), { params: Promise.resolve({ id }) })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.activities[0]).toMatchObject({ id: 'email-1', description: 'email-1', metadata: { gmail_message_id: 'gmail-1' } })
    expect(body.activities[0].metadata.body_text).toBeUndefined()
    errors.mockRestore()
  })

})
