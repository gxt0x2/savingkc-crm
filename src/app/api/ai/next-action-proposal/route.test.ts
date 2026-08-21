import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  actor: vi.fn(),
  lead360: vi.fn(),
  listWork: vi.fn(),
  start: vi.fn(),
  replay: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  generate: vi.fn(),
}))

vi.mock('ai', () => ({
  generateText: mocks.generate,
  Output: { object: ({ schema }: { schema: unknown }) => ({ schema }) },
}))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.authenticated }))
vi.mock('@/lib/assistant/auth', () => ({ resolveAssistantActor: mocks.actor }))
vi.mock('@/lib/assistant/queries', () => ({ readAssistantLead360: mocks.lead360 }))
vi.mock('@/lib/server/work-items', () => ({ listWorkItems: mocks.listWork }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))
vi.mock('@/lib/ai/generation-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ai/generation-store')>()
  return {
    ...actual,
    startAssistantArtifactGeneration: mocks.start,
    replayAssistantGeneration: mocks.replay,
    completeAssistantGeneration: mocks.complete,
    failAssistantGeneration: mocks.fail,
  }
})

import { POST } from './route'

const LEAD_ID = '10000000-0000-4000-8000-000000000001'
const ACTIVITY_ID = '20000000-0000-4000-8000-000000000001'
const GENERATION_ID = '30000000-0000-4000-8000-000000000001'
const THREAD_ID = '40000000-0000-4000-8000-000000000001'

function request(body: Record<string, unknown>, idempotencyKey = 'next-action:test') {
  return new Request('https://crm.savingkc.com/api/ai/next-action-proposal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(body),
  })
}

const proposal = {
  kind: 'callback',
  title: 'Call seller after family review',
  notes: 'Ask whether the family review changed the seller timeline and record the decision.',
  dueAt: '2026-08-24T18:00:00.000Z',
  rationale: 'The seller explicitly asked for a callback after speaking with family.',
  confidence: 'high',
  evidenceIds: [`activity:${ACTIVITY_ID}`],
}

const snapshot = {
  record: {
    lead: {
      id: LEAD_ID,
      full_name: 'Seller Example',
      station: 'lead',
      crmUrl: `https://crm.savingkc.com/leads/${LEAD_ID}`,
    },
    activities: [{
      id: ACTIVITY_ID,
      activity_type: 'call',
      description: 'Seller requested a callback after speaking with family.',
      created_at: '2026-08-21T13:00:00.000Z',
      metadata: {},
    }],
    appointments: [],
    transactionCoordination: [],
  },
}

describe('AI next-action proposal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-21T15:00:00.000Z'))
    mocks.authenticated.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', role: 'agent', access: 'agent' })
    mocks.listWork.mockResolvedValue([])
    mocks.lead360.mockResolvedValue(snapshot)
    mocks.start.mockResolvedValue({ created: true, generationId: GENERATION_ID, threadId: THREAD_ID, status: 'running' })
    mocks.generate.mockResolvedValue({
      output: proposal,
      finishReason: 'stop',
      finalStep: { model: { provider: 'openai', modelId: 'gpt-5.6-luna' } },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, inputTokenDetails: { cacheReadTokens: 0 } },
    })
    mocks.replay.mockResolvedValue({
      generationId: GENERATION_ID,
      threadId: THREAD_ID,
      status: 'complete',
      reply: JSON.stringify(proposal),
      sources: [{ name: 'call activity', url: `https://crm.savingkc.com/leads/${LEAD_ID}?section=activity` }],
      provider: 'openai',
      model: 'openai/gpt-5.6-luna',
      finishReason: 'stop',
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0 },
      estimatedCostMicros: 80,
    })
  })

  afterEach(() => vi.useRealTimers())

  it('rejects unauthenticated requests before reading the body or CRM', async () => {
    mocks.authenticated.mockResolvedValue(null)
    const input = request({ leadId: LEAD_ID })
    const parse = vi.spyOn(input, 'json')
    const response = await POST(input)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.lead360).not.toHaveBeenCalled()
  })

  it('persists before generation and returns only verified cited output', async () => {
    const response = await POST(request({ leadId: LEAD_ID }))
    expect(response.status).toBe(200)
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0])
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: 'casey@savingkc.com',
      requestId: createHash('sha256').update(`next-action-proposal:${LEAD_ID}:next-action:test`).digest('hex'),
      context: expect.objectContaining({ feature: 'next_action_proposal', leadId: LEAD_ID }),
    }))
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      generationId: GENERATION_ID,
      provider: 'openai',
      model: 'openai/gpt-5.6-luna',
      metadata: expect.objectContaining({ feature: 'next_action_proposal', leadId: LEAD_ID }),
      sources: [expect.objectContaining({ name: 'call activity' })],
    }))
    await expect(response.json()).resolves.toMatchObject({
      proposal: { title: proposal.title, evidenceIds: proposal.evidenceIds },
      generationId: GENERATION_ID,
      grounded: true,
      execution: 'proposal_only',
      approvalRequired: true,
    })
  })

  it('does not spend on a new proposal when open work already exists', async () => {
    mocks.listWork.mockResolvedValue([{ key: 'activity:task-1', title: 'Existing call', dueAt: null, assignedTo: 'Casey' }])
    const response = await POST(request({ leadId: LEAD_ID }))
    expect(response.status).toBe(409)
    expect(mocks.start).not.toHaveBeenCalled()
    expect(mocks.generate).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ code: 'open_work_exists', existingWorkItem: { title: 'Existing call' } })
  })

  it('fails the durable generation when the model invents every citation', async () => {
    mocks.generate.mockResolvedValue({
      output: { ...proposal, evidenceIds: ['activity:invented'] },
      finishReason: 'stop',
      finalStep: { model: { provider: 'openai', modelId: 'gpt-5.6-luna' } },
      usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, inputTokenDetails: { cacheReadTokens: 0 } },
    })
    const response = await POST(request({ leadId: LEAD_ID }))
    expect(response.status).toBe(503)
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ generationId: GENERATION_ID }))
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})
