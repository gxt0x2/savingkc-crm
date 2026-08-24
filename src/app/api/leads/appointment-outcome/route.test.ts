import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  from: vi.fn(),
  checkAutoAdvance: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.checkAutoAdvance }))

import { POST } from './route'

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/leads/appointment-outcome', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  })
}

function loadAppointment() {
  const chain: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order', 'limit']) chain[method] = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({
    data: { id: '22222222-2222-4222-8222-222222222222', notes: null, scheduled_at: '2026-10-01T15:30:00Z', status: 'scheduled' },
    error: null,
  }))
  return chain
}

function updateAppointment() {
  const result = { error: null }
  const chain: Record<string, unknown> = {
    update: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(resolve(result)),
  }
  return chain
}

describe('canonical appointment outcome route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey Davis' })
    mocks.checkAutoAdvance.mockResolvedValue({ advanced: true, from: 'appointment_set', to: 'qualified' })
  })

  it('rejects an unsigned user before parsing or touching appointment data', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    const req = { json: vi.fn(() => { throw new Error('must not parse') }) } as unknown as NextRequest
    const response = await POST(req)
    expect(response.status).toBe(401)
    expect(req.json).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('updates the canonical appointment and attributes evidence to the verified actor', async () => {
    const update = updateAppointment()
    const insert = vi.fn().mockResolvedValue({ error: null })
    let appointmentCalls = 0
    mocks.from.mockImplementation((table: string) => {
      if (table === 'appointments') return appointmentCalls++ === 0 ? loadAppointment() : update
      if (table === 'lead_activities') return { insert }
      throw new Error(`Unexpected table ${table}`)
    })

    const response = await POST(request({
      leadId: '11111111-1111-4111-8111-111111111111',
      appointmentId: '22222222-2222-4222-8222-222222222222',
      outcome: 'completed',
      notes: 'Seller attended',
      actor: 'Ernest',
    }))
    expect(response.status).toBe(200)
    expect(update.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }))
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'Casey Davis',
      metadata: expect.objectContaining({ actor_email: 'casey@savingkc.com' }),
    }))
    expect(mocks.checkAutoAdvance).toHaveBeenCalledWith('11111111-1111-4111-8111-111111111111', 'appointment_completed')
  })

  it('rejects fabricated identifiers before database access', async () => {
    const response = await POST(request({ leadId: 'not-a-uuid', outcome: 'completed' }))
    expect(response.status).toBe(400)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
