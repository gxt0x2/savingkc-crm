import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  recordAppointmentOutcome: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))
vi.mock('@/lib/server/appointment-outcome', () => ({
  recordAppointmentOutcome: mocks.recordAppointmentOutcome,
  AppointmentOutcomeError: class AppointmentOutcomeError extends Error {
    status: number
    code: string
    constructor(message: string, status: number, code: string) {
      super(message)
      this.status = status
      this.code = code
    }
  },
}))

import { AppointmentOutcomeError } from '@/lib/server/appointment-outcome'
import { POST } from './route'

const leadId = '11111111-1111-4111-8111-111111111111'
const appointmentId = '22222222-2222-4222-8222-222222222222'

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/leads/appointment-outcome', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

describe('canonical appointment outcome route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey Davis' })
    mocks.recordAppointmentOutcome.mockResolvedValue({
      success: true,
      appointmentId,
      outcome: 'completed',
      stage: { from: 'appointment_set', to: 'qualified', changed: true, exception: true },
      appointmentDate: null,
      followUpTaskKey: null,
      replacementAppointmentId: null,
    })
  })

  it('rejects an unsigned user before parsing or recording an outcome', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    const req = { json: vi.fn(() => { throw new Error('must not parse') }) } as unknown as NextRequest
    const response = await POST(req)
    expect(response.status).toBe(401)
    expect(req.json).not.toHaveBeenCalled()
    expect(mocks.recordAppointmentOutcome).not.toHaveBeenCalled()
  })

  it('records the outcome as the signed-in actor', async () => {
    const response = await POST(request({
      leadId,
      appointmentId,
      outcome: 'completed',
      completedNextStep: 'offer_presented',
      notes: 'Seller attended',
      actor: 'Ernest',
    }))
    expect(response.status).toBe(200)
    expect(mocks.recordAppointmentOutcome).toHaveBeenCalledWith(expect.objectContaining({
      actor: { email: 'casey@savingkc.com', name: 'Casey Davis' },
      source: 'appointment_outcome_review',
      request: expect.objectContaining({
        leadId,
        appointmentId,
        outcome: 'completed',
        completedNextStep: 'offer_presented',
        notes: 'Seller attended',
      }),
    }))
    await expect(response.json()).resolves.toMatchObject({ success: true, outcome: 'completed' })
  })

  it('rejects fabricated identifiers before recording an outcome', async () => {
    const response = await POST(request({ leadId: 'not-a-uuid', outcome: 'completed' }))
    expect(response.status).toBe(400)
    expect(mocks.recordAppointmentOutcome).not.toHaveBeenCalled()
  })

  it('returns the stage failure instead of success', async () => {
    mocks.recordAppointmentOutcome.mockRejectedValue(new AppointmentOutcomeError(
      'The lead stage could not be moved. The outcome was not completed.',
      500,
      'stage_failed',
    ))
    const response = await POST(request({
      leadId,
      appointmentId,
      outcome: 'no_show',
    }))
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body.success).toBeUndefined()
    expect(body.error).toMatch(/stage could not be moved/)
  })
})
