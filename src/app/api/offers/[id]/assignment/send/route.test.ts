import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  sendSubmitterInvite: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))

vi.mock('@/lib/docuseal', () => ({
  sendSubmitterInvite: mocks.sendSubmitterInvite,
}))

import { POST } from './route'

describe('DocuSeal assignment send containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DOCUSEAL_ENABLED', 'false')
  })

  it('returns 503 before database access or a buyer invitation', async () => {
    const request = new NextRequest('https://crm.savingkc.com/api/offers/offer-1/assignment/send', {
      method: 'POST',
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'offer-1' }) })

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    await expect(response.json()).resolves.toMatchObject({ code: 'DOCUSEAL_DISABLED' })
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled()
    expect(mocks.sendSubmitterInvite).not.toHaveBeenCalled()
  })
})
