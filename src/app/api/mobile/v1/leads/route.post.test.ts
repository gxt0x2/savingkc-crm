import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), user: vi.fn(), actor: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.user,
}))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(),
  resolveMobileScopedActor: mocks.actor,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { MobileAuthError } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError } from '@/lib/mobile-api/authorized-lead'
import { mobileManualLeadId } from '@/lib/mobile-api/create-mobile-lead'
import { POST } from './route'

type LeadRow = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  source: string | null
  station: string | null
  priority: string | null
  is_parked: boolean
  assigned_agent: string | null
  notes: string | null
  dead_reason: string | null
}

type ActivityRow = {
  id: string
  lead_id: string | null
  activity_type: string
  description: string
  agent: string
  metadata: Record<string, unknown>
}

type OptOutRow = { phone: string; reason: string | null; is_opted_out: boolean }

function memoryAdmin(seed?: { leads?: LeadRow[]; optOuts?: OptOutRow[]; failSuppression?: boolean }) {
  const leads: LeadRow[] = [...(seed?.leads ?? [])]
  const activities: ActivityRow[] = []
  const optOuts: OptOutRow[] = [...(seed?.optOuts ?? [])]
  const tables: string[] = []
  let seq = 0
  const duplicateRequest = (metadata: Record<string, unknown>) => activities.some((row) => (
    row.metadata.source === 'mobile_manual'
    && row.metadata.userId === metadata.userId
    && metadata.clientRequestId
    && row.metadata.clientRequestId === metadata.clientRequestId
  ))

  return {
    leads,
    activities,
    optOuts,
    tables,
    from(table: string) {
      tables.push(table)
      if (table !== 'leads' && table !== 'lead_activities' && table !== 'sms_opt_outs') {
        throw new Error(`unexpected table ${table}`)
      }
      return {
        insert(row: Record<string, unknown>) {
          if (table === 'sms_opt_outs') throw new Error('do-not-call list must stay unchanged')
          if (table === 'leads') {
            const id = typeof row.id === 'string' ? row.id : `lead-${++seq}`
            if (leads.some((lead) => lead.id === id)) {
              return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }) }
            }
            leads.push({
              id,
              full_name: typeof row.full_name === 'string' ? row.full_name : null,
              phone: typeof row.phone === 'string' ? row.phone : null,
              email: typeof row.email === 'string' ? row.email : null,
              property_address: typeof row.property_address === 'string' ? row.property_address : null,
              source: typeof row.source === 'string' ? row.source : null,
              station: typeof row.station === 'string' ? row.station : null,
              priority: typeof row.priority === 'string' ? row.priority : null,
              is_parked: row.is_parked === true,
              assigned_agent: typeof row.assigned_agent === 'string' ? row.assigned_agent : null,
              notes: typeof row.notes === 'string' ? row.notes : null,
              dead_reason: typeof row.dead_reason === 'string' ? row.dead_reason : null,
            })
            return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) }
          }
          const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>
          if (duplicateRequest(metadata)) {
            return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }) }
          }
          const id = `activity-${++seq}`
          activities.push({
            id,
            lead_id: typeof row.lead_id === 'string' ? row.lead_id : null,
            activity_type: String(row.activity_type),
            description: String(row.description ?? ''),
            agent: String(row.agent ?? ''),
            metadata,
          })
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) }
        },
        update() {
          throw new Error('existing contacts are not rewritten')
        },
        select() {
          const filters: Array<(row: LeadRow | ActivityRow | OptOutRow) => boolean> = []
          const source = table === 'leads' ? leads : table === 'lead_activities' ? activities : optOuts
          const chain = {
            in(column: string, values: readonly string[]) {
              filters.push((row) => values.includes(String((row as Record<string, unknown>)[column] ?? '')))
              return chain
            },
            ilike(column: string, value: string) {
              const expected = value.replace(/\\([\\%_])/g, '$1').toLowerCase()
              filters.push((row) => String((row as Record<string, unknown>)[column] ?? '').toLowerCase() === expected)
              return chain
            },
            eq(column: string, value: unknown) {
              if (column.startsWith('metadata->>')) {
                const key = column.slice('metadata->>'.length)
                filters.push((row) => (row as ActivityRow).metadata?.[key] === value)
              } else {
                filters.push((row) => (row as Record<string, unknown>)[column] === value)
              }
              return chain
            },
            limit() { return chain },
            maybeSingle: async () => {
              if (table === 'sms_opt_outs' && seed?.failSuppression) {
                return { data: null, error: { message: 'unavailable' } }
              }
              const found = source.find((row) => filters.every((filter) => filter(row)))
              return { data: found ?? null, error: null }
            },
            then(resolve: (value: { data: unknown[]; error: null }) => unknown, reject?: (reason: unknown) => unknown) {
              return Promise.resolve({
                data: source.filter((row) => filters.every((filter) => filter(row))),
                error: null,
              }).then(resolve, reject)
            },
          }
          return chain
        },
      }
    },
  }
}

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads', {
    method: 'POST',
    headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/mobile/v1/leads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ user: { id: 'user-1', email: 'Casey@SavingKC.com' } })
    mocks.actor.mockResolvedValue({ fullName: 'Casey Davis', email: 'casey@savingkc.com', assignmentAliases: ['Casey'] })
    mocks.admin.mockImplementation(() => memoryAdmin())
  })

  it('rejects a missing bearer token before writing', async () => {
    mocks.user.mockRejectedValue(new MobileAuthError('Missing bearer token'))
    const response = await POST(request({ name: 'Ada Seller', phone: '8165550101' }))
    expect(response.status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('rejects an agent with no CRM profile', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await POST(request({ name: 'Ada Seller', phone: '8165550101' }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ error: 'CRM profile not authorized' })
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('requires a name and a phone or email', async () => {
    const db = memoryAdmin()
    mocks.admin.mockReturnValue(db)
    expect((await POST(request({ phone: '8165550101' }))).status).toBe(400)
    expect((await POST(request({ name: 'Ada Seller' }))).status).toBe(400)
    expect((await POST(request({ name: 'Ada Seller', phone: 'not-a-phone' }))).status).toBe(400)
    expect((await POST(request({ name: 'Ada Seller', email: 'not-an-email' }))).status).toBe(400)
    expect(db.leads).toEqual([])
  })

  it('creates a manual contact owned by the agent', async () => {
    const db = memoryAdmin()
    mocks.admin.mockReturnValue(db)
    const response = await POST(request({
      name: ' Ada Seller ',
      phone: '(816) 555-0101',
      email: 'Ada@Example.com',
      address: '123 Main St',
      notes: 'Met at the door',
    }))
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({ ok: true, leadId: 'lead-1', existing: false })
    expect(db.leads).toEqual([expect.objectContaining({
      id: 'lead-1',
      full_name: 'Ada Seller',
      phone: '+18165550101',
      email: 'ada@example.com',
      property_address: '123 Main St',
      notes: 'Met at the door',
      source: 'mobile_manual',
      station: 'new',
      priority: 'warm',
      is_parked: false,
      assigned_agent: 'Casey Davis',
      dead_reason: null,
    })])
    expect(db.activities).toEqual([])
    expect(new Set(db.tables)).toEqual(new Set(['sms_opt_outs', 'leads']))
  })

  it('returns an existing phone match without inserting another contact', async () => {
    const db = memoryAdmin({
      leads: [{
        id: 'lead-existing',
        full_name: 'Ada Seller',
        phone: '(816) 555-0101',
        email: null,
        property_address: null,
        source: 'manual',
        station: 'qualified',
        priority: 'hot',
        is_parked: false,
        assigned_agent: 'Ernest',
        notes: null,
        dead_reason: 'dnc_refused',
      }],
    })
    mocks.admin.mockReturnValue(db)
    const response = await POST(request({ name: 'Different Name', phone: '+1 816-555-0101', email: 'new@example.com' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, leadId: 'lead-existing', existing: true })
    expect(db.leads).toHaveLength(1)
    expect(db.leads[0].dead_reason).toBe('dnc_refused')
    expect(db.leads[0].assigned_agent).toBe('Ernest')
  })

  it('returns an existing email match regardless of case', async () => {
    const db = memoryAdmin({
      leads: [{
        id: 'lead-email',
        full_name: 'Ada Seller',
        phone: null,
        email: 'Ada@Example.com',
        property_address: null,
        source: 'manual',
        station: 'new',
        priority: 'warm',
        is_parked: false,
        assigned_agent: 'Casey',
        notes: null,
        dead_reason: null,
      }],
    })
    mocks.admin.mockReturnValue(db)
    const response = await POST(request({ name: 'Ada Seller', email: 'ada@example.com' }))
    await expect(response.json()).resolves.toEqual({ ok: true, leadId: 'lead-email', existing: true })
    expect(db.leads).toHaveLength(1)
  })

  it('fails closed when the phone and email belong to different contacts', async () => {
    const db = memoryAdmin({
      leads: [
        {
          id: 'lead-phone', full_name: 'Phone Person', phone: '+18165550101', email: null,
          property_address: null, source: 'manual', station: 'new', priority: 'warm', is_parked: false,
          assigned_agent: 'Casey', notes: null, dead_reason: null,
        },
        {
          id: 'lead-email', full_name: 'Email Person', phone: null, email: 'ada@example.com',
          property_address: null, source: 'manual', station: 'new', priority: 'warm', is_parked: false,
          assigned_agent: 'Casey', notes: null, dead_reason: null,
        },
      ],
    })
    mocks.admin.mockReturnValue(db)
    const response = await POST(request({ name: 'Ada Seller', phone: '8165550101', email: 'ada@example.com' }))
    expect(response.status).toBe(409)
    expect(db.leads).toHaveLength(2)
  })

  it('replays the same clientRequestId as the original contact', async () => {
    const db = memoryAdmin()
    mocks.admin.mockReturnValue(db)
    const first = await POST(request({ name: 'Ada Seller', phone: '8165550101', clientRequestId: 'req-1' }))
    const second = await POST(request({ name: 'Someone Else', phone: '9135550199', clientRequestId: 'req-1' }))
    expect(await first.json()).toEqual({ ok: true, leadId: mobileManualLeadId('user-1', 'req-1'), existing: false })
    expect(await second.json()).toEqual({ ok: true, leadId: mobileManualLeadId('user-1', 'req-1'), existing: true })
    expect(db.leads).toHaveLength(1)
    expect(db.activities).toHaveLength(1)
  })

  it('saves a do-not-call number as a contact and leaves the flag in place', async () => {
    const db = memoryAdmin({ optOuts: [{ phone: '+18165550101', reason: 'DNC', is_opted_out: true }] })
    mocks.admin.mockReturnValue(db)
    const response = await POST(request({ name: 'Ada Seller', phone: '8165550101' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, existing: false })
    expect(db.leads[0]).toMatchObject({ phone: '+18165550101', dead_reason: 'dnc_refused', source: 'mobile_manual' })
    expect(db.optOuts).toEqual([{ phone: '+18165550101', reason: 'DNC', is_opted_out: true }])
  })

  it('does not treat an SMS stop as a voice do-not-call flag', async () => {
    const db = memoryAdmin({ optOuts: [{ phone: '+18165550101', reason: 'STOP', is_opted_out: true }] })
    mocks.admin.mockReturnValue(db)
    const response = await POST(request({ name: 'Ada Seller', phone: '8165550101' }))
    expect(response.status).toBe(200)
    expect(db.leads[0].dead_reason).toBeNull()
    expect(db.optOuts).toEqual([{ phone: '+18165550101', reason: 'STOP', is_opted_out: true }])
  })

  it('does not create a contact when do-not-call status cannot be verified', async () => {
    const db = memoryAdmin({ failSuppression: true })
    mocks.admin.mockReturnValue(db)
    const response = await POST(request({ name: 'Ada Seller', phone: '8165550101' }))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Do-not-call status could not be verified' })
    expect(db.leads).toEqual([])
  })

  it('returns the deterministic contact when a retry loses the insert race', async () => {
    const leadId = mobileManualLeadId('user-1', 'req-race')
    const db = memoryAdmin({
      leads: [{
        id: leadId, full_name: 'Ada Seller', phone: '+19135550199', email: null,
        property_address: null, source: 'mobile_manual', station: 'new', priority: 'warm', is_parked: false,
        assigned_agent: 'Casey Davis', notes: null, dead_reason: null,
      }],
    })
    mocks.admin.mockReturnValue(db)
    const response = await POST(request({ name: 'Ada Seller', email: 'ada@example.com', clientRequestId: 'req-race' }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, leadId, existing: true })
    expect(db.leads).toHaveLength(1)
  })

  it('maps an unexpected failure to a saved-contact error', async () => {
    mocks.actor.mockRejectedValue(new Error('profile store down'))
    const response = await POST(request({ name: 'Ada Seller', phone: '8165550101' }))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'Contact could not be saved' })
  })

  it('keeps MobileLeadAccessError status for a forbidden profile', async () => {
    mocks.actor.mockRejectedValue(new MobileLeadAccessError('CRM profile not authorized', 403))
    expect((await POST(request({ name: 'Ada Seller', phone: '8165550101' }))).status).toBe(403)
  })
})
