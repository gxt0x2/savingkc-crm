import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ user: vi.fn(), actor: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.user,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(),
  resolveMobileScopedActor: mocks.actor,
}))

import { GET } from './route'

function request() {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/calls/recent?scope=mine', {
    headers: { Authorization: 'Bearer user' },
  })
}

let activities: Array<Record<string, unknown>>
let relatedActivities: Array<Record<string, unknown>>
let activityFilters: string
let recordingFilters: string[]
let leadRows: Array<Record<string, unknown>>
let ownedPageOffset: number
let ownedPageFilters: string[]

function configureDatabase() {
  mocks.admin.mockReturnValue({
    from: (table: string) => {
      if (table !== 'lead_activities') return { select: () => ({ in: async () => ({ data: leadRows, error: null }) }) }
      let source: string | null = null
      const query = {
        select: () => query,
        in: () => query,
        eq: (_field: string, value: string) => { source = value; return query },
        or: (filters: string) => {
          if (source) recordingFilters.push(filters)
          else { activityFilters = filters; ownedPageFilters.push(filters) }
          return query
        },
        order: () => query,
        limit: async (limit: number) => {
          if (source) return { data: relatedActivities, error: null }
          const data = activities.slice(ownedPageOffset, ownedPageOffset + limit)
          ownedPageOffset += data.length
          return { data, error: null }
        },
      }
      return query
    },
  })
}

describe('mobile recent calls route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    activityFilters = ''
    recordingFilters = []
    ownedPageOffset = 0
    ownedPageFilters = []
    relatedActivities = []
    activities = [{
      id: 'call-ernest', lead_id: null, activity_type: 'call', agent: 'System', created_at: '2026-10-01T12:00:00Z',
      metadata: { direction: 'inbound', calledNumber: '+18166088588', from: '+18165550123', callSid: 'CA-1' },
    }]
    leadRows = []
    mocks.user.mockResolvedValue({ user: { id: 'auth-user-ernest', email: 'ernest@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', fullName: 'Ernest', access: 'owner', assignmentAliases: [] })
    configureDatabase()
  })

  it('returns only authenticated-user calls and an explicit account scope marker', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(activityFilters).toContain('metadata->>agent_identity.eq.ernest')
    expect(activityFilters).toContain('metadata->>userId.eq.auth-user-ernest')
    expect(activityFilters).toContain('metadata->>calledNumber.eq.+18166088588')
    await expect(response.json()).resolves.toMatchObject({ scope: 'mine', userId: 'auth-user-ernest', items: [{ id: 'call-ernest' }] })
  })

  it('keeps ownership scoped while paging past 500 excluded cold callbacks', async () => {
    activities = Array.from({ length: 500 }, (_, index) => ({
      id: `cold-${index}`, lead_id: null, activity_type: 'missed_call', agent: 'Ernest',
      created_at: `2026-10-02T12:00:00.123900+00:00`,
      metadata: { direction: 'inbound', source: 'cold_callback_press_1', from: '+18165550123' },
    }))
    activities.push({ id: 'older-valid', lead_id: null, activity_type: 'call', agent: 'Ernest', created_at: '2026-10-01T12:00:00Z', metadata: { direction: 'inbound', inboundRoute: 'direct_line', from: '+18165550123' } })
    const body = await (await GET(request())).json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['older-valid'])
    expect(ownedPageFilters).toHaveLength(2)
    expect(ownedPageFilters[1]).toContain('and(or(metadata->>actor_email.eq.ernest@savingkc.com')
    expect(ownedPageFilters[1]).toContain('created_at.lt."2026-10-02T12:00:00.123900+00:00"')
    expect(ownedPageFilters[1]).toContain('id.lt."cold-499"')
  })

  it('does not use lead assignment or generic company-line traffic as call ownership', async () => {
    activities = [{
      id: 'casey-call-on-ernest-lead', lead_id: 'lead-casey', activity_type: 'call', agent: 'System',
      created_at: '2026-10-01T12:00:00Z', metadata: { direction: 'inbound', calledNumber: '+18163077835', from: '+18165550123' },
    }]
    leadRows = [{ id: 'lead-casey', full_name: 'Seller', assigned_agent: 'Ernest' }]
    const response = await GET(request())
    const body = await response.json()
    expect(body.items).toEqual([])
  })

  it('denies conflicting durable ownership metadata even when the display name matches', async () => {
    activities = [{ id: 'misattributed', lead_id: null, activity_type: 'call', agent: 'Ernest', created_at: '2026-10-01T12:00:00Z', metadata: { actor_email: 'casey@savingkc.com' } }]
    const response = await GET(request())
    await expect(response.json()).resolves.toMatchObject({ scope: 'mine', items: [] })
  })

  it('keeps owned call history while withholding a lead profile assigned to another agent', async () => {
    mocks.user.mockResolvedValue({ user: { id: 'auth-user-casey', email: 'casey@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', access: 'agent', assignmentAliases: ['Casey'] })
    activities = [{ id: 'owned-call', lead_id: 'lead-casey', activity_type: 'call', agent: 'Casey', created_at: '2026-10-01T12:00:00Z', metadata: { actor_email: 'casey@savingkc.com' } }]
    leadRows = [{ id: 'lead-casey', full_name: 'Seller', assigned_agent: 'Ernest', phone: '+18165550123' }]
    const response = await GET(request())
    await expect(response.json()).resolves.toMatchObject({ items: [{ id: 'owned-call', leadId: 'lead-casey' }], leads: [] })
  })

  it('isolates account switches even when the database returns both users’ rows', async () => {
    mocks.user.mockResolvedValue({ user: { id: 'auth-user-casey', email: 'casey@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', access: 'agent', assignmentAliases: ['Casey'] })
    activities = [
      { id: 'call-ernest', lead_id: null, activity_type: 'call', agent: 'Ernest', created_at: '2026-10-01T12:00:00Z', metadata: { actor_email: 'ernest@savingkc.com', agent_identity: 'ernest', direction: 'outbound' } },
      { id: 'call-casey', lead_id: null, activity_type: 'call', agent: 'Casey', created_at: '2026-10-01T11:00:00Z', metadata: { actor_email: 'casey@savingkc.com', agent_identity: 'casey', direction: 'outbound' } },
    ]
    const response = await GET(request())
    const body = await response.json()
    expect(body).toMatchObject({ scope: 'mine', userId: 'auth-user-casey' })
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['call-casey'])
    expect(activityFilters).toContain('metadata->>actor_email.eq.casey@savingkc.com')
  })

  it('requires a bearer user before reading calls', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.user.mockRejectedValue(new MobileAuthError('Invalid bearer token'))
    expect((await GET(request())).status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('retains a canonical System recording callback for an owned direct-line attempt', async () => {
    const recordingId = '00000000-0000-4000-8000-000000000101'
    activities = [{ id: 'owned-direct', lead_id: 'lead-1', activity_type: 'call', agent: 'System', created_at: '2026-10-02T12:00:00Z',
      metadata: { direction: 'inbound', calledNumber: '+18166088588', from: '+19135550101', callSid: 'CA-owned', outcome: 'connected' } }]
    relatedActivities = [{ id: recordingId, lead_id: 'lead-1', activity_type: 'call', agent: 'System', created_at: '2026-10-02T12:01:00Z',
      metadata: { direction: 'inbound', from: '+19135550101', to: '+18166088588', callSid: 'CA-owned', duration: 70, recordingSid: `RE${'a'.repeat(32)}`, source: 'twilio_recording_callback' } }]
    leadRows = [{ id: 'lead-1', classification: 'lead', assigned_agent: 'Ernest' }]
    const body = await (await GET(request())).json()
    expect(body.items).toMatchObject([{ id: 'owned-direct', outcome: 'answered', durationSeconds: 70,
      recordingUrl: `/api/mobile/v1/calls/${recordingId}/recording` }])
    expect(recordingFilters[0]).toContain('metadata->>callSid.in.("CA-owned")')
    expect(recordingFilters[0]).not.toContain('from.eq')
  })

  it('rejects another native agent identity before the dedicated-line fallback', async () => {
    activities = [{ id: 'other-agent', lead_id: null, activity_type: 'call', agent: 'Casey', created_at: '2026-10-02T12:00:00Z',
      metadata: { direction: 'inbound', calledNumber: '+18166088588', from: '+19135550101', agent_identity: 'casey', callSid: 'CA-other' } }]
    const body = await (await GET(request())).json()
    expect(body.items).toEqual([])
    expect(recordingFilters).toEqual([])
  })

  it('returns an eligible older call when 100 newer owned cold callbacks are excluded', async () => {
    activities = Array.from({ length: 100 }, (_, index) => ({ id: `cold-${index}`, lead_id: null, activity_type: 'call', agent: 'Ernest',
      created_at: new Date(Date.parse('2026-10-02T12:00:00Z') - index * 1000).toISOString(),
      metadata: { direction: 'inbound', from: '+19135550101', source: 'cold_callback_press_1' } }))
    activities.push({ id: 'valid-older', lead_id: null, activity_type: 'call', agent: 'Ernest', created_at: '2026-10-02T11:00:00Z',
      metadata: { direction: 'inbound', calledNumber: '+18163077835', from: '+19135550101' } })
    const body = await (await GET(request())).json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(['valid-older'])
  })

  it('does not attach foreign, conflicting-owner, or mismatched-lead recording evidence', async () => {
    activities = [{ id: 'owned-direct', lead_id: 'lead-1', activity_type: 'call', agent: 'System', created_at: '2026-10-02T12:00:00Z',
      metadata: { direction: 'inbound', calledNumber: '+18166088588', from: '+19135550101', callSid: 'CA-owned' } }]
    const callback = { id: '00000000-0000-4000-8000-000000000101', lead_id: 'lead-1', activity_type: 'call', agent: 'System',
      created_at: '2026-10-02T12:01:00Z', metadata: { source: 'twilio_recording_callback', callSid: 'CA-owned', recordingSid: `RE${'a'.repeat(32)}` } }
    relatedActivities = [
      { ...callback, metadata: { ...callback.metadata, callSid: 'CA-foreign' } },
      { ...callback, id: '00000000-0000-4000-8000-000000000102', metadata: { ...callback.metadata, actor_email: 'casey@savingkc.com' } },
      { ...callback, id: '00000000-0000-4000-8000-000000000103', lead_id: 'lead-other' },
    ]
    leadRows = [{ id: 'lead-1', classification: 'lead', assigned_agent: 'Ernest' }]
    const body = await (await GET(request())).json()
    expect(body.items).toHaveLength(1)
    expect(body.items[0].recordingUrl).toBeNull()
    expect(body.leads.map((lead: { id: string }) => lead.id)).toEqual(['lead-1'])
  })

  it('withholds recording evidence and profile when the owned call lead was reassigned', async () => {
    mocks.user.mockResolvedValue({ user: { id: 'auth-user-casey', email: 'casey@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', access: 'agent', assignmentAliases: ['Casey'] })
    activities = [{ id: 'owned-call', lead_id: 'lead-1', activity_type: 'call', agent: 'Casey', created_at: '2026-10-01T12:00:00Z',
      metadata: { actor_email: 'casey@savingkc.com', callSid: 'CA-owned' } }]
    relatedActivities = [{ id: '00000000-0000-4000-8000-000000000101', lead_id: 'lead-1', activity_type: 'call', agent: 'System', created_at: '2026-10-02T12:01:00Z',
      metadata: { source: 'twilio_recording_callback', callSid: 'CA-owned', recordingSid: `RE${'a'.repeat(32)}` } }]
    leadRows = [{ id: 'lead-1', assigned_agent: 'Ernest', classification: 'lead' }]
    const body = await (await GET(request())).json()
    expect(body.items).toMatchObject([{ id: 'owned-call', recordingUrl: null }])
    expect(body.leads).toEqual([])
  })
})
