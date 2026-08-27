import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const LEAD_ID = 'e5152e75-dbd8-4fa5-9c3b-f702c42d8b9b'
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  reenrich: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({ requireAuthenticatedUser: mocks.auth }))
vi.mock('@/lib/auto-enrich', () => ({ forceReenrichLead: mocks.reenrich }))

import { POST } from './route'

const params = { params: Promise.resolve({ id: LEAD_ID }) }

function request() {
  return new NextRequest(`https://crm.savingkc.com/api/leads/${LEAD_ID}/reenrich`, { method: 'POST' })
}

describe('lead re-enrich route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.reenrich.mockResolvedValue({
      success: true,
      prospectMatch: true,
      countyEnriched: true,
    })
  })

  it('rejects anonymous callers before touching enrichment', async () => {
    mocks.auth.mockResolvedValue(new Response('Unauthorized', { status: 401 }))

    const response = await POST(request(), params)

    expect(response.status).toBe(401)
    expect(mocks.reenrich).not.toHaveBeenCalled()
  })

  it('force-re-enriches the canonical lead with overwrite', async () => {
    const response = await POST(request(), params)

    expect(response.status).toBe(200)
    expect(mocks.reenrich).toHaveBeenCalledWith(LEAD_ID)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      countyEnriched: true,
    })
  })

  it('does not report success when county details stay blank', async () => {
    mocks.reenrich.mockResolvedValue({
      success: false,
      prospectMatch: true,
      countyEnriched: false,
      error: 'County assessor did not return property details',
    })

    const response = await POST(request(), params)

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      countyEnriched: false,
    })
  })
})
