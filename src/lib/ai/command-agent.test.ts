import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ settings: [] as Array<Record<string, unknown>> }))
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
  beforeEach(() => { mocks.settings.length = 0 })

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
})
