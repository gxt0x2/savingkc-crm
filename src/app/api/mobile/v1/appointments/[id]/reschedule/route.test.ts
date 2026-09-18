import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileActor: mocks.actor,
}))
vi.mock('@/lib/server/mobile-appointments', async (original) => ({
  ...await original<typeof import('@/lib/server/mobile-appointments')>(), executeMobileAppointmentCommand: mocks.execute,
}))
import { POST } from './route'

const appointmentId = '22222222-2222-4222-8222-222222222222'

describe('mobile appointment reschedule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' } })
    mocks.execute.mockResolvedValue({ success: true, created: false, appointment: { id: appointmentId } })
  })

  it('requires and forwards both times, time zone, and version', async () => {
    const response = await POST(new NextRequest(`https://crm.savingkc.com/api/mobile/v1/appointments/${appointmentId}/reschedule`, {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'appointment-reschedule-1' },
      body: JSON.stringify({ expectedVersion: 4, scheduledAt: '2026-10-02T15:00:00Z', endsAt: '2026-10-02T16:00:00Z', timeZone: 'America/Chicago', notes: 'New time' }),
    }), { params: Promise.resolve({ id: appointmentId }) })
    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'reschedule', appointmentId, expectedVersion: 4,
      payload: expect.objectContaining({ scheduledAt: '2026-10-02T15:00:00.000Z', endsAt: '2026-10-02T16:00:00.000Z' }),
    }))
  })
})
