import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  reserve: vi.fn(),
  complete: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileActor: mocks.requireActor,
}))
vi.mock('@/lib/mobile-api/command-receipts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/command-receipts')>(),
  reserveMobileCommand: mocks.reserve,
  completeMobileCommand: mocks.complete,
}))
vi.mock('@/lib/server/mobile-property-details', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/mobile-property-details')>(),
  updateMobilePropertyDetails: mocks.update,
}))

import { POST } from './route'

const leadId = '1705b085-47c6-432d-9371-97dcabfc9bbc'
const context = { params: Promise.resolve({ id: leadId }) }
const body = {
  bedrooms: 3,
  bathrooms: 1.5,
  sqft: 1320,
  yearBuilt: 1954,
  occupancyStatus: 'owner',
  expectedUpdatedAt: '2026-09-18T18:00:00.000Z',
}
function request() {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads/${leadId}/property`, {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Idempotency-Key': 'property-key-1', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('mobile property mutation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireActor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' } })
    mocks.reserve.mockResolvedValue({ kind: 'reserved' })
    mocks.complete.mockResolvedValue(undefined)
    mocks.update.mockResolvedValue({ property: { id: 'property-1', bedrooms: 3, bathrooms: 1.5, sqft: 1320, yearBuilt: 1954, occupancyStatus: 'owner', updatedAt: '2026-09-18T18:01:00.000Z' } })
  })

  it('awaits the canonical update and completes its retry receipt', async () => {
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ success: true, property: { bedrooms: 3 } })
    expect(mocks.update).toHaveBeenCalledOnce()
    expect(mocks.complete).toHaveBeenCalledOnce()
  })

  it('replays an exact duplicate without writing again', async () => {
    mocks.reserve.mockResolvedValue({ kind: 'replay', status: 200, result: { success: true, property: { id: 'property-1', bedrooms: 3 } } })
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    expect(mocks.update).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ property: { id: 'property-1' } })
  })

  it('returns the saved canonical property when only receipt reconciliation fails', async () => {
    mocks.complete.mockRejectedValue(new Error('receipt unavailable'))
    const response = await POST(request(), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      property: { id: 'property-1' },
      warning: expect.stringMatching(/saved.*reconciliation/i),
    })
    expect(mocks.update).toHaveBeenCalledOnce()
  })
})
