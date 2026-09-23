import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  hiddenLead: vi.fn(),
  deleteAppointment: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/auth/oauth-review-sandbox-session', () => ({
  oauthReviewForeignLeadResponse: mocks.hiddenLead,
}))
vi.mock('@/lib/server/delete-appointment', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/delete-appointment')>()
  return { ...actual, deleteCrmAppointment: mocks.deleteAppointment }
})

import { POST } from './route'

const LEAD_ID = '10000000-0000-4000-8000-000000000001'
const APPOINTMENT_ID = '20000000-0000-4000-8000-000000000002'

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/leads/delete-appointment', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('delete appointment route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hiddenLead.mockResolvedValue(null)
    mocks.deleteAppointment.mockResolvedValue({
      ok: true,
      appointmentId: APPOINTMENT_ID,
      deleted: true,
      rolledBack: true,
      station: 'contacted',
      googleCalendar: { status: 'synced', eventId: 'evt-1' },
      warnings: [],
    })
  })

  it('rejects anonymous requests before deleting', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await POST(request({ leadId: LEAD_ID, appointmentId: APPOINTMENT_ID }))
    expect(response.status).toBe(401)
    expect(mocks.deleteAppointment).not.toHaveBeenCalled()
  })

  it('deletes for the signed-in CRM operator', async () => {
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    const response = await POST(request({ leadId: LEAD_ID, appointmentId: APPOINTMENT_ID }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      appointmentId: APPOINTMENT_ID,
      rolledBack: true,
      station: 'contacted',
    })
    expect(mocks.deleteAppointment).toHaveBeenCalledWith(expect.objectContaining({
      leadId: LEAD_ID,
      appointmentId: APPOINTMENT_ID,
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
    }))
  })

  it('hides appointments on leads outside the OAuth review sandbox', async () => {
    mocks.actor.mockResolvedValue({ email: 'oauth-review@savingkc.com', name: 'OAuth Review' })
    mocks.hiddenLead.mockResolvedValue(new Response(JSON.stringify({ error: 'Lead not found' }), { status: 404 }))
    const response = await POST(request({ leadId: LEAD_ID, appointmentId: APPOINTMENT_ID }))
    expect(response.status).toBe(404)
    expect(mocks.deleteAppointment).not.toHaveBeenCalled()
  })
})
