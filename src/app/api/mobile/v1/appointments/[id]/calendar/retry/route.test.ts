import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), sync: vi.fn(), get: vi.fn() }))
vi.mock('@/lib/mobile-api/mobile-command-access', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/mobile-command-access')>(),
  requireAuthorizedMobileAppointment: mocks.actor,
}))
vi.mock('@/lib/server/mobile-appointment-calendar', async (original) => ({
  ...await original<typeof import('@/lib/server/mobile-appointment-calendar')>(),
  syncMobileAppointmentCalendar: mocks.sync,
}))
vi.mock('@/lib/server/mobile-appointments', async (original) => ({
  ...await original<typeof import('@/lib/server/mobile-appointments')>(),
  getMobileAppointmentById: mocks.get,
}))

import { MobileCalendarRetryError } from '@/lib/server/mobile-appointment-calendar'
import { MobileCommandAccessError } from '@/lib/mobile-api/mobile-command-access'
import { POST } from './route'

const id = '11111111-1111-4111-8111-111111111111'
const leadId = '22222222-2222-4222-8222-222222222222'
const params = { params: Promise.resolve({ id }) }
function request(body: unknown) {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/appointments/${id}/calendar/retry`, {
    method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('mobile appointment calendar owner retry', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' }, leadId })
    mocks.sync.mockResolvedValue({ status: 'synced' })
    mocks.get.mockResolvedValue({ id, leadId, version: 3, sync: { provider: 'synced' } })
  })

  it('uses authenticated lead scope and an expected-version guard', async () => {
    const res = await POST(request({ leadId, expectedVersion: 3 }), params)
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ success: true, appointment: { id, version: 3 } })
    expect(mocks.sync).toHaveBeenCalledWith({ appointmentId: id, actorEmail: 'ernest@savingkc.com', expectedVersion: 3, requireOwner: true })
  })

  it('rejects wrong-contact input before provider work', async () => {
    const res = await POST(request({ leadId: 'other', expectedVersion: 3 }), params)
    expect(res.status).toBe(400)
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('does not reach the provider when appointment/lead scope rejects the bearer actor', async () => {
    mocks.actor.mockRejectedValue(new MobileCommandAccessError('This appointment is outside your authorized scope', 403))
    const res = await POST(request({ leadId, expectedVersion: 3 }), params)
    expect(res.status).toBe(403)
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('returns 403 for the non-owner without provider work', async () => {
    mocks.sync.mockRejectedValue(new MobileCalendarRetryError('Only the original calendar owner can retry sync.', 403))
    const res = await POST(request({ leadId, expectedVersion: 3 }), params)
    expect(res.status).toBe(403)
    expect(mocks.get).not.toHaveBeenCalled()
  })

  it('returns 409 for a stale appointment version', async () => {
    mocks.sync.mockRejectedValue(new MobileCalendarRetryError('Refresh before retrying calendar sync.', 409))
    const res = await POST(request({ leadId, expectedVersion: 2 }), params)
    expect(res.status).toBe(409)
    expect(mocks.get).not.toHaveBeenCalled()
  })
})
