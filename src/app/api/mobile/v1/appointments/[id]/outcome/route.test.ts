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

const leadId = '11111111-1111-4111-8111-111111111111'
const appointmentId = '22222222-2222-4222-8222-222222222222'

describe('mobile appointment outcome', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' } })
    mocks.execute.mockResolvedValue({ success: true, created: false, appointment: { id: appointmentId } })
  })

  it('binds the URL appointment to the submitted contact and version', async () => {
    const response = await POST(new NextRequest(`https://crm.savingkc.com/api/mobile/v1/appointments/${appointmentId}/outcome`, {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'appointment-cancel-1' },
      body: JSON.stringify({ leadId, outcome: 'cancelled', notes: 'Seller cancelled', expectedVersion: 5 }),
    }), { params: Promise.resolve({ id: appointmentId }) })
    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'outcome', appointmentId, leadId, expectedVersion: 5,
      payload: { outcome: 'cancelled', notes: 'Seller cancelled' },
    }))
  })

  it('does not accept rescheduled as an outcome label', async () => {
    const response = await POST(new NextRequest(`https://crm.savingkc.com/api/mobile/v1/appointments/${appointmentId}/outcome`, {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'appointment-outcome-1' },
      body: JSON.stringify({ leadId, outcome: 'rescheduled', expectedVersion: 5 }),
    }), { params: Promise.resolve({ id: appointmentId }) })
    expect(response.status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
