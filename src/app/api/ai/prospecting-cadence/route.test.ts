import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'

const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  actor: vi.fn(),
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

const GENERATION_ID = '30000000-0000-4000-8000-000000000001'
const THREAD_ID = '40000000-0000-4000-8000-000000000001'
const draft = {
  rationale: 'A short respectful cadence gives the seller room to respond.',
  steps: [
    { delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, this is {{agent_name}} with SavingKC. Would you consider selling {{property_address}}?' },
    { delayMinutes: 1440, bodyTemplate: 'Just following up, {{first_name}}. Is selling something you would consider this year?' },
  ],
}

function request(body: Record<string, unknown>, key = 'cadence:test-request') {
  return new Request('https://crm.savingkc.com/api/ai/prospecting-cadence', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body),
  })
}

describe('AI prospecting cadence route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.authenticated.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', role: 'agent', access: 'agent' })
    mocks.start.mockResolvedValue({ created: true, generationId: GENERATION_ID, threadId: THREAD_ID, status: 'running' })
    mocks.generate.mockResolvedValue({
      output: draft,
      finishReason: 'stop',
      finalStep: { model: { provider: 'openai', modelId: 'gpt-5.6-luna' } },
      usage: { inputTokens: 80, outputTokens: 60, totalTokens: 140, inputTokenDetails: { cacheReadTokens: 0 } },
    })
    mocks.replay.mockResolvedValue({
      generationId: GENERATION_ID,
      threadId: THREAD_ID,
      status: 'complete',
      reply: JSON.stringify(draft),
      sources: [],
      provider: 'openai',
      model: 'openai/gpt-5.6-luna',
      usage: { inputTokens: 80, outputTokens: 60, totalTokens: 140, cacheReadTokens: 0 },
      estimatedCostMicros: 88,
    })
  })

  it('rejects unauthenticated requests before reading the body or starting a generation', async () => {
    mocks.authenticated.mockResolvedValue(null)
    const input = request({ campaignName: 'September absentee' })
    const parse = vi.spyOn(input, 'json')
    const response = await POST(input)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('requires a stable idempotency key', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/ai/prospecting-cadence', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(400)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('persists before model work and returns an unapplied proposal', async () => {
    const response = await POST(request({ campaignName: 'September absentee', currentSteps: draft.steps }))
    expect(response.status).toBe(200)
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0])
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: 'casey@savingkc.com',
      requestId: createHash('sha256').update('prospecting-cadence:casey@savingkc.com:cadence:test-request').digest('hex'),
      context: expect.objectContaining({ feature: 'prospecting_cadence', campaignName: 'September absentee' }),
    }))
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'openai',
      model: 'openai/gpt-5.6-luna',
      sources: [],
      toolTrace: [],
      metadata: expect.objectContaining({ feature: 'prospecting_cadence', draft }),
    }))
    await expect(response.json()).resolves.toMatchObject({ draft, approvalRequired: true, execution: 'proposal_only' })
  })

  it('replays a completed draft without another model call', async () => {
    mocks.start.mockResolvedValue({ created: false, generationId: GENERATION_ID, threadId: THREAD_ID, status: 'complete' })
    const response = await POST(request({ campaignName: 'September absentee' }))
    expect(response.status).toBe(200)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(mocks.complete).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ draft, generationId: GENERATION_ID, approvalRequired: true })
  })

  it('marks invalid model output failed instead of returning it', async () => {
    mocks.generate.mockResolvedValue({
      output: { ...draft, steps: [{ delayMinutes: 0, bodyTemplate: 'Hi {{seller_phone}}, call me about your property please.' }] },
      finishReason: 'stop',
      finalStep: { model: { provider: 'openai', modelId: 'gpt-5.6-luna' } },
      usage: { inputTokens: 80, outputTokens: 20, totalTokens: 100, inputTokenDetails: { cacheReadTokens: 0 } },
    })
    const response = await POST(request({ campaignName: 'September absentee' }))
    expect(response.status).toBe(503)
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ generationId: GENERATION_ID, code: 'prospecting_cadence_generation_failed' }))
    expect(mocks.complete).not.toHaveBeenCalled()
  })
})
