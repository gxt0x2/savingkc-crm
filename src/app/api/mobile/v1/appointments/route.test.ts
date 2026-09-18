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

const leadId = '11111111-1111-4111-8111-111111111111'
const body = {
  leadId, type: 'in_person', scheduledAt: '2026-10-01T15:00:00Z', endsAt: '2026-10-01T16:00:00Z',
  title: 'Seller visit', location: '2808 W 49th St', timeZone: 'America/Chicago',
  assignedTo: 'Ernest', notes: 'Bring comps', sendReminder: false,
}

function request(payload: unknown = body, key = 'appointment-create-1') {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/appointments', {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(payload),
  })
}

describe('mobile appointment create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' } })
    mocks.execute.mockResolvedValue({ success: true, created: true, appointment: { id: 'appointment-1' } })
  })

  it('uses the authenticated actor and complete canonical editor payload', async () => {
    const response = await POST(request())
    expect(response.status).toBe(201)
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      actor: { email: 'ernest@savingkc.com', name: 'Ernest' },
      idempotencyKey: 'appointment-create-1', command: 'create', leadId,
      payload: expect.objectContaining({ title: 'Seller visit', endsAt: '2026-10-01T16:00:00.000Z', timeZone: 'America/Chicago' }),
    }))
  })

  it('rejects missing retry identity and unsupported fields before mutation', async () => {
    expect((await POST(request(body, 'short'))).status).toBe(400)
    expect((await POST(request({ ...body, actor: 'Casey' }))).status).toBe(400)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('rejects reminder delivery until a real provider is configured', async () => {
    const response = await POST(request({ ...body, sendReminder: true }))
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({
      error: 'Seller reminders are not configured for mobile appointments.',
    })
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('returns 409 for conflicting retry-key reuse', async () => {
    mocks.execute.mockRejectedValue(new AppointmentCommandError('That Idempotency-Key belongs to a different appointment command.', 'conflict'))
    const response = await POST(request())
    expect(response.status).toBe(409)
  })
})
