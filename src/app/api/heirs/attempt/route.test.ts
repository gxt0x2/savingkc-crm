import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  findEvidence: vi.fn(),
  insertEvidence: vi.fn(),
  recordAppointment: vi.fn(),
  phoneRow: {
    id: 'phone-1',
    phone: '+18165550100',
    contact_name: 'Jamie Heir',
    relationship: 'child',
    prospect_id: 'prospect-1',
    verified_source: null as string | null,
    prospects: { lead_id: 'lead-1', owner_1: 'Original Owner' },
  },
  updates: [] as Array<{ table: string; payload: Record<string, unknown>; id: unknown }>,
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/heir-attempt-evidence', () => ({
  findHeirAttemptEvidence: mocks.findEvidence,
  insertHeirAttemptEvidenceOnce: mocks.insertEvidence,
}))
vi.mock('@/lib/server/heir-appointment-command', () => ({ recordHeirAppointment: mocks.recordAppointment }))
vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from(table: string) {
      return {
        select() {
          return {
            eq() {
              return {
                async single() { return { data: mocks.phoneRow, error: null } },
              }
            },
          }
        },
        update(payload: Record<string, unknown>) {
          return {
            async eq(_field: string, id: unknown) {
              mocks.updates.push({ table, payload, id })
              return { error: null }
            },
          }
        },
      }
    },
  },
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/heirs/attempt', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('heir attempt mutation trust', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updates.length = 0
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.findEvidence.mockResolvedValue(null)
    mocks.insertEvidence.mockResolvedValue({ id: 'activity-1', metadata: null })
    mocks.recordAppointment.mockResolvedValue({ appointmentId: 'appointment-1', activityId: 'activity-appointment' })
  })

  it('rejects anonymous requests before parsing or touching CRM data', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request({ prospect_phone_id: 'phone-1', disposition: 'no_answer' })
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.insertEvidence).not.toHaveBeenCalled()
  })

  it('uses the authenticated actor and durable attempt identity', async () => {
    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      lead_id: 'lead-1',
      disposition: 'callback_requested',
      agent: 'Spoofed Agent',
      clientAttemptId: 'attempt-1',
    }))

    expect(response.status).toBe(200)
    expect(mocks.updates[0]).toMatchObject({
      table: 'prospect_phones',
      payload: { last_attempt_by: 'Casey' },
    })
    expect(mocks.insertEvidence).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      clientAttemptId: 'attempt-1',
      payload: expect.objectContaining({
        agent: 'Casey',
        metadata: expect.objectContaining({ client_attempt_id: 'attempt-1' }),
      }),
    }))
  })

  it('rejects a client lead that does not own the selected heir phone', async () => {
    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      lead_id: 'another-lead',
      disposition: 'no_answer',
    }))

    expect(response.status).toBe(409)
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.insertEvidence).not.toHaveBeenCalled()
  })

  it('rejects an unknown outcome before querying the heir phone', async () => {
    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      disposition: 'ai_says_hot',
    }))

    expect(response.status).toBe(400)
    expect(mocks.findEvidence).not.toHaveBeenCalled()
    expect(mocks.updates).toHaveLength(0)
  })

  it('records a real canonical appointment before the call evidence', async () => {
    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      disposition: 'appointment_set',
      appointmentAt: '2027-08-24T15:00:00.000Z',
      clientAttemptId: 'attempt-appointment',
    }))

    expect(response.status).toBe(200)
    expect(mocks.recordAppointment).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      actorName: 'Casey',
      appointmentAt: '2027-08-24T15:00:00.000Z',
      clientAttemptId: 'attempt-appointment',
    }))
    expect(mocks.insertEvidence).toHaveBeenCalledWith(expect.objectContaining({
      activityType: 'call',
      payload: expect.objectContaining({
        metadata: expect.objectContaining({ appointment_id: 'appointment-1' }),
      }),
    }))
  })

  it('refuses to rewrite an existing attempt with conflicting facts', async () => {
    mocks.findEvidence.mockResolvedValue({
      id: 'activity-existing',
      metadata: {
        disposition: 'no_answer',
        prospect_phone_id: 'phone-1',
        scheduled_at: null,
        mark_as_lead: false,
        dead_reason: null,
      },
    })

    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      disposition: 'callback_requested',
      clientAttemptId: 'attempt-1',
    }))

    expect(response.status).toBe(409)
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.insertEvidence).not.toHaveBeenCalled()
  })
})
