import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  appointment: vi.fn(),
  advance: vi.fn(),
  appointmentConversion: vi.fn(),
  activityInsert: vi.fn(),
  leadUpdate: vi.fn(),
}))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/appointments', () => ({ upsertAppointmentFromCall: mocks.appointment }))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.advance }))
vi.mock('@/lib/ppc/appointment-booked-conversion', () => ({
  queuePpcAppointmentBookedConversion: mocks.appointmentConversion,
}))
vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from(table: string) {
      if (table === 'leads') {
        const query = {
          select: vi.fn(),
          eq: vi.fn(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: { phone: '+18165550100', full_name: 'Seller', property_address: '123 Main' },
            error: null,
          }),
        }
        query.select.mockReturnValue(query)
        query.eq.mockReturnValue(query)
        return {
          ...query,
          update(payload: unknown) {
            mocks.leadUpdate(payload)
            return { async eq() { return { error: null } } }
          },
        }
      }
      if (table === 'lead_activities') {
        return {
          insert(payload: unknown) {
            mocks.activityInsert(payload)
            return {
              select() {
                return { async maybeSingle() { return { data: { id: 'activity-1' }, error: null } } }
              },
            }
          },
        }
      }
      throw new Error(`Unexpected table: ${table}`)
    },
  },
}))

import { POST } from './route'

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/leads/create-appointment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('appointment command route trust boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.appointment.mockResolvedValue({
      id: 'appointment-1',
      scheduled_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      type: 'phone_call',
      notes: 'Call seller',
    })
    mocks.advance.mockResolvedValue({ advanced: true, from: 'contacted', to: 'appointment_set' })
    mocks.appointmentConversion.mockResolvedValue({ queued: true })
  })

  it('rejects anonymous requests before parsing the body', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request({ leadId: 'lead-1' })
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
  })

  it('uses the authenticated actor when validating assignee authority', async () => {
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    const response = await POST(request({
      leadId: 'lead-1',
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      assignedTo: 'Fake Agent',
    }))
    expect(response.status).toBe(403)
  })

  it('saves a canonical appointment and advances through the governed lifecycle', async () => {
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    const response = await POST(request({
      leadId: 'lead-1',
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      assignedTo: 'Ernest',
      notes: 'Call seller',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      appointmentId: 'appointment-1',
      lifecycleAdvanced: true,
    })
    expect(mocks.advance).toHaveBeenCalledWith('lead-1', 'appointment_set')
    expect(mocks.activityInsert).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: 'lead-1', activity_type: 'appointment', agent: 'Ernest',
    }))
  })

  it('does not invent an appointment id when canonical persistence fails', async () => {
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.appointment.mockResolvedValue(null)
    const response = await POST(request({
      leadId: 'lead-1',
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      assignedTo: 'Ernest',
    }))

    expect(response.status).toBe(500)
    expect(mocks.activityInsert).not.toHaveBeenCalled()
    expect(mocks.advance).not.toHaveBeenCalled()
  })

  it('reports a pending lifecycle refresh without inviting a duplicate appointment', async () => {
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.advance.mockRejectedValue(new Error('lifecycle unavailable'))
    const response = await POST(request({
      leadId: 'lead-1',
      scheduledAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      assignedTo: 'Ernest',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      appointmentId: 'appointment-1',
      lifecycleAdvanced: false,
      warning: expect.stringContaining('Do not create it again'),
    })
  })
})
