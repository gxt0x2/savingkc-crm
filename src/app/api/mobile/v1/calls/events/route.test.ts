import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), admin: vi.fn(), user: vi.fn(), actor: vi.fn(), optOut: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.user }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(),
  requireAuthorizedMobileLead: mocks.authorize,
  resolveMobileScopedActor: mocks.actor,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/sms-opt-out', () => ({ handleOptOut: mocks.optOut }))
import { MobileAuthError } from '@/lib/mobile-api/auth'
import { POST } from './route'

type StoredCall = {
  id: string
  lead_id: string | null
  activity_type: string
  description: string
  agent: string
  metadata: Record<string, unknown>
}

function memoryAdmin() {
  const rows: StoredCall[] = []
  const tables: string[] = []
  let seq = 0
  return {
    rows,
    tables,
    from(table: string) {
      tables.push(table)
      return {
        insert(row: Record<string, unknown>) {
          if (table !== 'lead_activities') throw new Error(`unexpected insert into ${table}`)
          const metadata = (row.metadata && typeof row.metadata === 'object' ? row.metadata : {}) as Record<string, unknown>
          const duplicate = rows.some((existing) => existing.lead_id == null
            && existing.metadata.source === 'savingkc_mobile'
            && existing.metadata.userId === metadata.userId
            && existing.metadata.phone === metadata.phone
            && metadata.clientCallId
            && existing.metadata.clientCallId === metadata.clientCallId)
          if (duplicate) {
            return { select: () => ({ single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }) }) }
          }
          const id = `call-${++seq}`
          rows.push({
            id,
            lead_id: typeof row.lead_id === 'string' ? row.lead_id : null,
            activity_type: String(row.activity_type),
            description: String(row.description ?? ''),
            agent: String(row.agent ?? ''),
            metadata,
          })
          return { select: () => ({ single: async () => ({ data: { id }, error: null }) }) }
        },
        update(patch: Record<string, unknown>) {
          return {
            eq(column: string, value: string) {
              if (table === 'leads') return Promise.resolve({ error: null })
              const row = column === 'id' ? rows.find((item) => item.id === value) : undefined
              if (row && patch.metadata && typeof patch.metadata === 'object') {
                row.metadata = patch.metadata as Record<string, unknown>
                row.description = String(patch.description ?? row.description)
                row.agent = String(patch.agent ?? row.agent)
              }
              const payload = { data: row ? { id: row.id } : null, error: row ? null : { message: 'missing' } }
              return Object.assign(Promise.resolve({ error: payload.error }), {
                select: () => ({ single: async () => payload }),
              })
            },
          }
        },
        select() {
          const filters: Array<(row: StoredCall) => boolean> = []
          const chain = {
            is(column: string, value: null) {
              filters.push((row) => value === null && (row as Record<string, unknown>)[column] == null)
              return chain
            },
            eq(column: string, value: unknown) {
              if (column.startsWith('metadata->>')) {
                const key = column.slice('metadata->>'.length)
                filters.push((row) => row.metadata[key] === value)
              } else {
                filters.push((row) => (row as Record<string, unknown>)[column] === value)
              }
              return chain
            },
            limit() { return chain },
            maybeSingle: async () => {
              const found = rows.find((row) => filters.every((filter) => filter(row)))
              return { data: found ? { id: found.id, metadata: found.metadata } : null, error: null }
            },
          }
          return chain
        },
      }
    },
  }
}

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/calls/events', {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

const adHocEnded = () => request({ phone: '(816) 553-7559', event: 'ended', clientCallId: 'attempt-adhoc' })

describe('mobile call-event scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ user: { id: 'user-ernest', email: 'Ernest@SavingKC.com' } })
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', fullName: 'Ernest' })
    mocks.optOut.mockResolvedValue(undefined)
  })

  it('rejects an out-of-scope lead before inserting or touching a timestamp', async () => {
    const { MobileLeadAccessError } = await import('@/lib/mobile-api/authorized-lead')
    mocks.authorize.mockRejectedValue(new MobileLeadAccessError('outside scope', 403))
    const response = await POST(request({ leadId: 'lead-1', phone: '+18165550123', event: 'started' }))
    expect(response.status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.optOut).not.toHaveBeenCalled()
  })

  it('saves an ad-hoc dial on the phone without inventing a lead', async () => {
    const db = memoryAdmin()
    mocks.admin.mockReturnValue(db)
    for (const leadId of [undefined, '']) {
      const response = await POST(request({
        leadId,
        phone: '(816) 553-7559',
        event: 'ended',
        outcome: 'unknown',
        disposition: 'no_answer',
        note: 'Left a card',
        clientCallId: 'attempt-adhoc',
      }))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true, activityId: 'call-1', skipped: false })
    }
    expect(mocks.actor).toHaveBeenCalledWith('ernest@savingkc.com')
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect([...new Set(db.tables)]).toEqual(['lead_activities'])
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0]).toMatchObject({
      lead_id: null,
      agent: 'Ernest',
      metadata: {
        source: 'savingkc_mobile',
        phone: '+18165537559',
        clientCallId: 'attempt-adhoc',
        userId: 'user-ernest',
        userEmail: 'ernest@savingkc.com',
        disposition: 'no_answer',
        notes: 'Left a card',
        outcome: 'unknown',
      },
    })
    expect(db.rows[0].metadata).not.toHaveProperty('leadId')
    expect(db.rows[0].metadata).not.toHaveProperty('opportunityId')
    expect(mocks.optOut).not.toHaveBeenCalled()
  })

  it('returns the same id when the same phone and clientCallId are posted again', async () => {
    const db = memoryAdmin()
    mocks.admin.mockReturnValue(db)
    const first = await POST(request({ phone: '+18165537559', event: 'started', clientCallId: 'attempt-1' }))
    const second = await POST(request({
      phone: '(816) 553-7559',
      event: 'ended',
      outcome: 'voicemail',
      disposition: 'left_voicemail',
      clientCallId: 'attempt-1',
    }))
    const replayedStart = await POST(request({ phone: '+18165537559', event: 'started', clientCallId: 'attempt-1' }))
    expect(await first.json()).toMatchObject({ activityId: 'call-1', skipped: false })
    expect(await second.json()).toEqual({ ok: true, activityId: 'call-1', skipped: false })
    expect(await replayedStart.json()).toMatchObject({ activityId: 'call-1', skipped: false })
    expect(db.rows).toHaveLength(1)
    expect(db.rows[0].metadata).toMatchObject({ event: 'ended', outcome: 'voicemail', disposition: 'left_voicemail' })
  })

  it('does not answer an ad-hoc call event without a CRM session', async () => {
    mocks.user.mockRejectedValueOnce(new MobileAuthError('Missing bearer token'))
    expect((await POST(adHocEnded())).status).toBe(401)
    mocks.actor.mockResolvedValueOnce(null)
    const outsideCrm = await POST(adHocEnded())
    expect(outsideCrm.status).toBe(403)
    expect(await outsideCrm.json()).toMatchObject({ error: 'CRM profile not authorized' })
    expect(mocks.admin).not.toHaveBeenCalled()
    expect(mocks.optOut).not.toHaveBeenCalled()
  })

  it('still requires phone and event', async () => {
    const response = await POST(request({ leadId: 'lead-1' }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'phone and event are required' })
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('stores the verified actor instead of a client-supplied agent', async () => {
    mocks.authorize.mockResolvedValue({ actor: { fullName: 'Casey' }, user: { id: 'user-casey', email: 'casey@savingkc.com' } })
    const inserted: Array<Record<string, unknown>> = []
    mocks.admin.mockReturnValue({ from: (table: string) => table === 'lead_activities'
      ? { insert: (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: 'call-1' }, error: null }) }) } } }
      : { update: () => ({ eq: async () => ({ error: null }) }) },
    })
    const response = await POST(request({ leadId: 'lead-1', phone: '+18165550123', event: 'started', agent: 'Ernest' }))
    expect(response.status).toBe(200)
    expect(inserted[0]).toMatchObject({ agent: 'Casey', lead_id: 'lead-1', metadata: { userId: 'user-casey', userEmail: 'casey@savingkc.com' } })
    expect(mocks.optOut).not.toHaveBeenCalled()
  })

  it('adds a DNC phone to the existing suppression list with or without a lead', async () => {
    const db = memoryAdmin()
    mocks.admin.mockReturnValue(db)
    const unassigned = await POST(request({
      phone: '(816) 553-7559',
      event: 'ended',
      outcome: 'unknown',
      disposition: 'dnc',
      clientCallId: 'attempt-dnc',
    }))
    expect(unassigned.status).toBe(200)
    expect(await unassigned.json()).toMatchObject({ ok: true, activityId: 'call-1', skipped: false })
    expect(mocks.optOut).toHaveBeenCalledWith('+18165537559', 'DNC')
    expect(db.rows[0]).toMatchObject({ lead_id: null, metadata: { disposition: 'dnc', phone: '+18165537559' } })

    mocks.authorize.mockResolvedValue({ actor: { fullName: 'Casey' }, user: { id: 'user-casey', email: 'casey@savingkc.com' } })
    const assigned = await POST(request({
      leadId: 'lead-1',
      phone: '+18165550123',
      event: 'ended',
      outcome: 'unknown',
      disposition: 'dnc',
      clientCallId: 'attempt-lead-dnc',
    }))
    expect(assigned.status).toBe(200)
    expect(await assigned.json()).toMatchObject({ ok: true, activityId: 'call-2' })
    expect(mocks.optOut).toHaveBeenCalledWith('+18165550123', 'DNC')
    expect(db.rows[1]).toMatchObject({ lead_id: 'lead-1', metadata: { disposition: 'dnc' } })
    expect(db.tables.filter((table) => table === 'prospects' || table === 'prospect_phones')).toEqual([])
  })

  it('fails closed when DNC suppression cannot be saved', async () => {
    mocks.optOut.mockRejectedValueOnce(new Error('SMS opt-out could not be saved'))
    const db = memoryAdmin()
    mocks.admin.mockReturnValue(db)
    const response = await POST(request({
      phone: '+18165537559',
      event: 'ended',
      disposition: 'dnc',
      clientCallId: 'attempt-dnc',
    }))
    expect(response.status).toBe(500)
    expect(await response.json()).toMatchObject({ error: 'Do-not-call status could not be saved' })
    expect(db.rows).toHaveLength(0)
  })
})
