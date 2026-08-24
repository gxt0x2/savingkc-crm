import fs from 'fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminOrSecret: vi.fn(),
  insert: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.requireAdminOrSecret }))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert: mocks.insert }) }),
}))

import { POST } from './route'

const validCall = {
  record_id: 'mojo-1',
  contact_name: 'Seller',
  phone_number: '9135550123',
  property_address: '123 Main',
  city: 'Kansas City',
  state: 'MO',
  zip: '64111',
  call_date: '2026-08-24T12:00:00Z',
  call_duration: 90,
  disposition: 'Callback requested',
  agent_name: 'Casey',
}

describe('/api/mojo/sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminOrSecret.mockResolvedValue(null)
    mocks.insert.mockResolvedValue({ error: null })
  })

  it('rejects an untrusted request before parsing or writing', async () => {
    mocks.requireAdminOrSecret.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const request = new Request('https://crm.savingkc.com/api/mojo/sync', { method: 'POST', body: '{' })
    const response = await POST(request as never)
    expect(response.status).toBe(401)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('queues normalized provider facts and rejects malformed rows', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ calls: [validCall, { disposition: 'No answer' }] }),
    }) as never)
    await expect(response.json()).resolves.toEqual({ queued: 1, skipped: 0, rejected: 1, total: 2 })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'mojo-1', status: 'pending',
    }))
  })

  it('contains no Manifest, scoring, enrichment, alert, or outbound-message work', () => {
    const source = fs.readFileSync('src/app/api/mojo/sync/route.ts', 'utf8')
    expect(source).not.toMatch(/manifest-builder|opportunity_score|classification|safeSendSMS|sendTeamLeadAlert|transcribeAudio|analyzeCallTranscript|enrichManifest/i)
  })
})
