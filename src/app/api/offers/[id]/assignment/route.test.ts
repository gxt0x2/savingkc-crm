import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  supabaseAdmin: vi.fn(),
  createSubmission: vi.fn(),
  archiveSubmission: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: mocks.supabaseAdmin,
}))

vi.mock('@/lib/docuseal', () => ({
  createSubmission: mocks.createSubmission,
  archiveSubmission: mocks.archiveSubmission,
  ASSIGNMENT_TEMPLATE_ID: 19,
}))

import { DELETE, POST } from './route'

const context = { params: Promise.resolve({ id: 'offer-1' }) }

describe('DocuSeal assignment mutation containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('DOCUSEAL_ENABLED', 'false')
  })

  it.each([
    ['POST', () => POST(new NextRequest('https://crm.savingkc.com/api/offers/offer-1/assignment', { method: 'POST' }), context)],
    ['DELETE', () => DELETE(new NextRequest('https://crm.savingkc.com/api/offers/offer-1/assignment', { method: 'DELETE' }), context)],
  ])('returns 503 before %s reaches the database or DocuSeal', async (_method, invoke) => {
    const response = await invoke()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    await expect(response.json()).resolves.toMatchObject({ code: 'DOCUSEAL_DISABLED' })
    expect(mocks.supabaseAdmin).not.toHaveBeenCalled()
    expect(mocks.createSubmission).not.toHaveBeenCalled()
    expect(mocks.archiveSubmission).not.toHaveBeenCalled()
  })
})
