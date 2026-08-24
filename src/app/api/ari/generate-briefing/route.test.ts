import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  resolveAssistantActor: vi.fn(),
  readAssistantLead360: vi.fn(),
  getState: vi.fn(),
  queue: vi.fn(),
  supabaseAdmin: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveAuthenticatedActor }))
vi.mock('@/lib/assistant/auth', () => ({ resolveAssistantActor: mocks.resolveAssistantActor }))
vi.mock('@/lib/assistant/queries', () => ({ readAssistantLead360: mocks.readAssistantLead360 }))
vi.mock('@/lib/server/canonical-lead-briefing', () => ({
  getCanonicalLeadBriefingState: mocks.getState,
  queueCanonicalLeadBriefing: mocks.queue,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.supabaseAdmin }))

import { GET, POST } from './route'

const leadId = '11111111-1111-4111-8111-111111111111'

describe('canonical briefing API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.resolveAssistantActor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', role: 'agent', access: 'agent' })
    mocks.readAssistantLead360.mockResolvedValue({ record: { lead: { id: leadId } } })
    mocks.getState.mockResolvedValue({ leadId, briefing: null, freshness: 'missing', refresh: null })
    mocks.queue.mockResolvedValue(4)
    mocks.supabaseAdmin.mockReturnValue({})
  })

  it('rejects unauthenticated reads before CRM access', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    const response = await GET(new Request(`https://crm.savingkc.com/api/ari/generate-briefing?leadId=${leadId}`))

    expect(response.status).toBe(401)
    expect(mocks.readAssistantLead360).not.toHaveBeenCalled()
  })

  it('tombstones the old manifest contract without reading it', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/ari/generate-briefing?manifestId=legacy-1'))

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({ code: 'manifest_briefing_retired' })
    expect(mocks.readAssistantLead360).not.toHaveBeenCalled()
  })

  it('returns actor-scoped canonical briefing state', async () => {
    const response = await GET(new Request(`https://crm.savingkc.com/api/ari/generate-briefing?leadId=${leadId}`))

    expect(response.status).toBe(200)
    expect(mocks.readAssistantLead360).toHaveBeenCalledWith({}, expect.objectContaining({ email: 'casey@savingkc.com' }), leadId)
    expect(mocks.getState).toHaveBeenCalledWith(leadId)
  })

  it('queues a manual refresh instead of performing provider I/O in the request', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/ari/generate-briefing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId }),
    }))

    expect(response.status).toBe(202)
    expect(mocks.queue).toHaveBeenCalledWith({
      leadId,
      reason: 'manual_refresh',
      requestedBy: 'casey@savingkc.com',
      delaySeconds: 0,
    })
    await expect(response.json()).resolves.toMatchObject({ queued: true, revision: 4 })
  })
})
