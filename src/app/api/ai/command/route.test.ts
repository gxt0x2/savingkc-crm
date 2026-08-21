import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  authenticated: vi.fn(),
  resolveActor: vi.fn(),
  start: vi.fn(),
  load: vi.fn(),
  replay: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  generate: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.authenticated }))
vi.mock('@/lib/assistant/auth', () => ({
  resolveAssistantActor: mocks.resolveActor,
  assistantActorCanReadCompanyWide: (actor: { access: string }) => actor.access !== 'agent',
}))
vi.mock('@/lib/assistant/queries', () => ({
  readAssistantAttention: vi.fn(),
  readAssistantOperatingSnapshot: vi.fn(),
  readAssistantPhoneSystem: vi.fn(),
  readAssistantWorkflowRegistry: vi.fn(),
}))
vi.mock('@/lib/ai/command-agent', () => ({
  commandAgentInstructions: () => 'instructions',
  createCommandAgent: () => ({ generate: mocks.generate }),
}))
vi.mock('@/lib/ai/generation-store', () => ({
  AssistantGenerationError: class AssistantGenerationError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  startAssistantGeneration: mocks.start,
  loadAssistantThread: mocks.load,
  replayAssistantGeneration: mocks.replay,
  completeAssistantGeneration: mocks.complete,
  failAssistantGeneration: mocks.fail,
  buildAssistantToolTrace: () => ({ trace: [], sources: [] }),
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new Request('https://crm.savingkc.com/api/ai/command', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const completed = {
  generationId: 'generation-1', threadId: 'thread-1', responseMessageId: 'response-1', status: 'complete',
  reply: 'Grounded answer', sources: [], provider: 'openai', model: 'openai/gpt-5.4-mini', finishReason: 'stop',
  usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 0 }, estimatedCostMicros: 30,
}

describe('durable AI command route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.AI_GATEWAY_API_KEY = 'configured'
    mocks.authenticated.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.resolveActor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', role: 'agent', access: 'agent' })
    mocks.start.mockResolvedValue({ created: true, threadId: 'thread-1', generationId: 'generation-1', requestMessageId: 'request-1', responseMessageId: null, status: 'running' })
    mocks.load.mockResolvedValue({ thread: { id: 'thread-1' }, messages: [{ id: 'request-1', role: 'user', content: 'What needs attention?', attachments: [], sources: [] }] })
    mocks.generate.mockResolvedValue({
      text: 'Grounded answer', toolResults: [], finishReason: 'stop',
      finalStep: { model: { provider: 'openai', modelId: 'gpt-5.4-mini' } },
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, inputTokenDetails: { cacheReadTokens: 0 } },
    })
    mocks.replay.mockResolvedValue(completed)
  })

  it('rejects unauthenticated requests before parsing or touching the ledger', async () => {
    mocks.authenticated.mockResolvedValue(null)
    const input = request({ messages: [{ role: 'user', content: 'hello' }] })
    const parse = vi.spyOn(input, 'json')
    const response = await POST(input)
    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('uses the verified actor, persists before generation, and records provider accounting', async () => {
    const response = await POST(request({
      actorEmail: 'spoofed@example.com', requestId: 'request-123', surface: 'giraffe',
      messages: [{ role: 'user', content: 'What needs attention?' }],
    }))
    expect(response.status).toBe(200)
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: 'casey@savingkc.com', actorName: 'Casey', requestId: 'request-123', surface: 'giraffe',
    }))
    expect(mocks.start.mock.invocationCallOrder[0]).toBeLessThan(mocks.generate.mock.invocationCallOrder[0])
    expect(mocks.complete).toHaveBeenCalledWith(expect.objectContaining({
      actorEmail: 'casey@savingkc.com', provider: 'openai', model: 'openai/gpt-5.4-mini',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cacheReadTokens: 0 },
    }))
    expect(await response.json()).toMatchObject({ reply: 'Grounded answer', threadId: 'thread-1', execution: 'read_only' })
  })

  it('replays a completed idempotent request without calling the model', async () => {
    mocks.start.mockResolvedValue({ created: false, threadId: 'thread-1', generationId: 'generation-1', status: 'complete' })
    const response = await POST(request({ requestId: 'same-request', messages: [{ role: 'user', content: 'hello' }] }))
    expect(response.status).toBe(200)
    expect(mocks.generate).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ reply: 'Grounded answer', generationId: 'generation-1' })
  })

  it('marks the ledger error and returns a generic failure when the provider throws', async () => {
    mocks.generate.mockRejectedValue(new Error('provider secret failure'))
    const response = await POST(request({ messages: [{ role: 'user', content: 'hello' }] }))
    expect(response.status).toBe(500)
    expect(mocks.fail).toHaveBeenCalledWith(expect.objectContaining({ generationId: 'generation-1', actorEmail: 'casey@savingkc.com' }))
    expect(await response.json()).toEqual({ error: 'The AI Assistant could not complete this request.' })
  })
})
