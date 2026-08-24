import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  upsertAppointmentFromCall: vi.fn(),
  checkAutoAdvance: vi.fn(),
  queuePpcAppointmentBookedConversion: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/appointments', () => ({
  upsertAppointmentFromCall: mocks.upsertAppointmentFromCall,
}))

vi.mock('@/lib/pipeline-auto-advance', () => ({
  checkAutoAdvance: mocks.checkAutoAdvance,
}))

vi.mock('@/lib/ppc/appointment-booked-conversion', () => ({
  queuePpcAppointmentBookedConversion: mocks.queuePpcAppointmentBookedConversion,
}))

import { POST } from './route'

function request(body: Record<string, unknown>, secret = 'booking-secret') {
  return new Request('https://crm.savingkc.com/api/leads/ppc/book', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify(body),
  })
}

describe('POST /api/leads/ppc/book', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('PPC_BOOKING_WEBHOOK_SECRET', 'booking-secret')
    vi.stubEnv('CAL_COM_WEBHOOK_SECRET', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('rejects retired Manifest-only identifiers without a database lookup', async () => {
    const response = await POST(request({
      manifestId: 'legacy-manifest',
      scheduledAt: '2026-08-25T15:00:00.000Z',
    }) as never)

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: 'Manifest identifiers are retired. Include the canonical leadId.',
    })
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects an invalid webhook secret before parsing or database work', async () => {
    const response = await POST(request({ leadId: 'lead-1' }, 'wrong-secret') as never)
    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('preserves canonical appointment, lifecycle, timeline, and conversion work', async () => {
    mocks.upsertAppointmentFromCall.mockResolvedValue({ id: 'appointment-1' })
    mocks.checkAutoAdvance.mockResolvedValue({ advanced: true })
    mocks.queuePpcAppointmentBookedConversion.mockResolvedValue({ queued: true, reason: 'queued' })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          update: () => ({
            eq: async () => ({ error: null }),
          }),
        }
      }
      if (table === 'lead_activities') {
        return {
          insert: () => ({
            select: () => ({
              maybeSingle: async () => ({ data: { id: 'activity-1' }, error: null }),
            }),
          }),
        }
      }
      throw new Error(`Unexpected table ${table}`)
    })

    const response = await POST(request({
      leadId: 'lead-1',
      bookingId: 'booking-1',
      scheduledAt: '2026-08-25T15:00:00.000Z',
      attendeeName: 'Seller One',
    }) as never)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      leadId: 'lead-1',
      appointmentId: 'appointment-1',
      lifecycleAdvanced: true,
      conversion: { queued: true, reason: 'queued' },
    })
    expect(mocks.from).not.toHaveBeenCalledWith('manifests')
    expect(mocks.queuePpcAppointmentBookedConversion).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      appointmentId: 'appointment-1',
      activityId: 'activity-1',
    }))
  })
})
