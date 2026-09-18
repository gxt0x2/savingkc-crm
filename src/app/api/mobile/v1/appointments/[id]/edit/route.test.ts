import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileActor: mocks.actor,
}))
vi.mock('@/lib/server/mobile-appointments', async (original) => ({
  ...await original<typeof import('@/lib/server/mobile-appointments')>(), executeMobileAppointmentCommand: mocks.execute,
}))
import { AppointmentCommandError } from '@/lib/server/mobile-appointments'
import { POST } from './route'

const appointmentId = '22222222-2222-4222-8222-222222222222'
function request(body: unknown) {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/appointments/${appointmentId}/edit`, {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'appointment-edit-1' },
    body: JSON.stringify(body),
  })
}

describe('mobile appointment edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'casey@savingkc.com', name: 'Casey' } })
    mocks.execute.mockResolvedValue({ success: true, created: false, appointment: { id: appointmentId } })
  })

  it('sends only a validated patch with the expected version', async () => {
    const response = await POST(request({ expectedVersion: 3, patch: { title: 'Updated title', notes: '' } }), {
      params: Promise.resolve({ id: appointmentId }),
    })
    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      command: 'edit', appointmentId, expectedVersion: 3,
      payload: { title: 'Updated title', notes: null },
    }))
  })

  it('surfaces stale-version conflicts', async () => {
    mocks.execute.mockRejectedValue(new AppointmentCommandError('This appointment changed on another device. Refresh before editing it again.', 'conflict'))
    const response = await POST(request({ expectedVersion: 3, patch: { title: 'Updated title' } }), {
      params: Promise.resolve({ id: appointmentId }),
    })
    expect(response.status).toBe(409)
  })
})
