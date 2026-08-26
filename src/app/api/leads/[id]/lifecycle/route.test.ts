import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  apply: vi.fn(),
  appointment: vi.fn(),
  qualification: vi.fn(),
  qualifiedConversion: vi.fn(),
  appointmentConversion: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/crm-lifecycle', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/crm-lifecycle')>(),
  applyCrmLifecycleCommand: mocks.apply,
  leadHasGovernedAppointment: mocks.appointment,
}))
vi.mock('@/lib/qualification-policy', () => ({
  getLeadQualificationStatus: mocks.qualification,
  qualificationError: () => 'Qualification evidence is incomplete',
}))
vi.mock('@/lib/ppc/qualified-lead-conversion', () => ({ queuePpcQualifiedLeadConversion: mocks.qualifiedConversion }))
vi.mock('@/lib/ppc/appointment-booked-conversion', () => ({ queuePpcAppointmentBookedConversion: mocks.appointmentConversion }))

import { POST } from './route'

const routeParams = { params: Promise.resolve({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }) }
const commandId = '11111111-1111-4111-8111-111111111111'

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/leads/x/lifecycle', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'idempotency-key': commandId },
    body: JSON.stringify(body),
  })
}

describe('lead lifecycle command route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.qualification.mockResolvedValue({ qualified: true, missing: [] })
    mocks.appointment.mockResolvedValue(true)
    mocks.qualifiedConversion.mockResolvedValue({ queued: true })
    mocks.appointmentConversion.mockResolvedValue({ queued: true })
    mocks.apply.mockResolvedValue({
      eventId: 'event-1', leadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      stage: 'contacted', classification: 'lead', priority: 'warm', owner: 'Casey',
      deadReason: null, fromStage: 'new', replayed: false,
    })
  })

  it('rejects anonymous commands before parsing request data', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request({ action: 'transition', stage: 'contacted' })
    const parse = vi.spyOn(req, 'json')
    const response = await POST(req, routeParams)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('ignores client actor fields and uses the verified session actor', async () => {
    const response = await POST(request({
      action: 'transition', stage: 'contacted', actor: 'Ernest', actorEmail: 'fake@example.com',
    }), routeParams)
    expect(response.status).toBe(200)
    expect(mocks.apply).toHaveBeenCalledWith(expect.objectContaining({
      commandId,
      actorEmail: 'casey@savingkc.com',
      actorName: 'Casey',
      stage: 'contacted',
    }))
    await expect(response.json()).resolves.not.toHaveProperty('compatibilityWarning')
  })

  it('requires a structured reason before a terminal dead transition', async () => {
    const response = await POST(request({ action: 'transition', stage: 'dead' }), routeParams)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ requiresDeadReason: true })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('rejects arbitrary owner labels outside the operating roster', async () => {
    const response = await POST(request({ action: 'assign', owner: 'Fake Operator' }), routeParams)
    expect(response.status).toBe(403)
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('blocks appointment stage without a governed appointment record', async () => {
    mocks.appointment.mockResolvedValue(false)
    const response = await POST(request({ action: 'transition', stage: 'appointment_set' }), routeParams)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ requiresAppointmentDetails: true })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('returns the missing qualification pillars without attempting a lifecycle write', async () => {
    mocks.qualification.mockResolvedValue({
      qualified: false,
      missing: ['PRICE'],
      pillars: { TIMELINE: true, CONDITION: true, MOTIVATION: true, PRICE: false },
    })

    const response = await POST(request({ action: 'transition', stage: 'qualified' }), routeParams)

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'qualification_incomplete',
      missingPillars: ['PRICE'],
    })
    expect(mocks.apply).not.toHaveBeenCalled()
  })

  it('requires explicit signed seller-contract evidence before the Dispositions handoff', async () => {
    const response = await POST(request({ action: 'transition', stage: 'under_contract' }), routeParams)
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'seller_contract_evidence_required' })
    expect(mocks.apply).not.toHaveBeenCalled()
  })
})
