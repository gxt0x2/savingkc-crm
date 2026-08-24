import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  settings: [] as Array<Record<string, unknown>>,
  providerSettings: [] as Array<Record<string, unknown>>,
  chatModel: vi.fn(() => ({ provider: 'groq.chat', modelId: 'openai/gpt-oss-120b' })),
}))
vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: vi.fn((settings: Record<string, unknown>) => {
    mocks.providerSettings.push(settings)
    return { chatModel: mocks.chatModel }
  }),
}))
vi.mock('ai', () => ({
  ToolLoopAgent: class ToolLoopAgent {
    constructor(settings: Record<string, unknown>) { mocks.settings.push(settings); return settings }
  },
  isStepCount: () => vi.fn(),
  tool: (definition: unknown) => definition,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))

import { createCommandAgent } from './command-agent'

describe('command agent actor tool boundary', () => {
  beforeEach(() => {
    mocks.settings.length = 0
    mocks.providerSettings.length = 0
  })

  it('gives an agent only actor-scoped CRM tools', () => {
    createCommandAgent({ email: 'casey@savingkc.com', fullName: 'Casey', role: 'agent', access: 'agent' })
    const tools = mocks.settings[0].tools as Record<string, unknown>
    expect(Object.keys(tools).sort()).toEqual(['findContacts', 'getContact360', 'getContactCommunications', 'getMyAttention'].sort())
    expect(tools).not.toHaveProperty('getOperatingSnapshot')
    expect(tools).not.toHaveProperty('getPhoneSystem')
  })

  it('adds protected company-wide tools only for an owner or admin', () => {
    createCommandAgent({ email: 'ernest@savingkc.com', fullName: 'Ernest', role: 'owner', access: 'owner' })
    const tools = mocks.settings[0].tools as Record<string, unknown>
    expect(tools).toHaveProperty('getOperatingSnapshot')
    expect(tools).toHaveProperty('getPhoneSystem')
    expect(tools).toHaveProperty('getWorkflowRegistry')
  })

  it('uses the configured Groq OpenAI-compatible model without changing the actor tool boundary', () => {
    process.env.GROQ_API_KEY = 'configured'
    createCommandAgent({ email: 'casey@savingkc.com', fullName: 'Casey', role: 'agent', access: 'agent' }, 'groq')
    expect(mocks.chatModel).toHaveBeenCalledWith('openai/gpt-oss-120b')
    expect(mocks.settings[0].model).toEqual({ provider: 'groq.chat', modelId: 'openai/gpt-oss-120b' })
    expect(Object.keys(mocks.settings[0].tools as Record<string, unknown>).sort()).toEqual(['findContacts', 'getContact360', 'getContactCommunications', 'getMyAttention'].sort())
    const transform = mocks.providerSettings[0].transformRequestBody as (body: Record<string, unknown>) => Record<string, unknown>
    expect(transform({ messages: [{ role: 'assistant', reasoning_content: 'private', tool_calls: [{ id: 'call-1' }] }] })).toEqual({
      messages: [{ role: 'assistant', tool_calls: [{ id: 'call-1' }] }],
    })
    delete process.env.GROQ_API_KEY
  })
})
