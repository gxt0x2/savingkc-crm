import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@/lib/assistant/auth', () => ({
  resolveAssistantActor: mocks.resolve,
  assistantActorCanReadCompanyWide: (actor: { access: string }) => actor.access === 'owner' || actor.access === 'admin',
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert: async () => ({ error: null }) }) }),
}))

vi.mock('@/lib/server/line-type-lookup', () => ({
  runLineTypeLookup: mocks.run,
}))

import { registerCrmMcpTools } from './server'

const OWNER = { email: 'owner@savingkc.com', fullName: 'Owner', role: 'owner', access: 'owner' }

type ToolHandler = (
  args: { phones: string[] },
  context: { authInfo?: { extra?: { email?: string } }, requestId: string, sessionId?: string },
) => Promise<{ content: Array<{ text: string }>, isError?: boolean }>

function tools() {
  const registered = new Map<string, { description?: string, handler: ToolHandler }>()
  const server = {
    registerTool(name: string, config: { description?: string }, handler: ToolHandler) {
      registered.set(name, { description: config.description, handler })
    },
  }
  registerCrmMcpTools(server as unknown as McpServer)
  return registered
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolve.mockResolvedValue(OWNER)
  mocks.run.mockResolvedValue({
    status: 200,
    body: {
      ok: true,
      rows: [{ e164: '+18165550100', valid: true, line_type: 'mobile', carrier: 'T-Mobile', checked_at: '2026-11-19T18:00:00.000Z', error: null }],
      csv: 'e164,valid,line_type,carrier,checked_at\n"+18165550100",true,mobile,T-Mobile,2026-11-19T18:00:00.000Z\n',
      usage: { usedToday: 1, remaining: 999, counted: 1, limit: 1000 },
    },
  })
})

describe('crm_line_type_lookup MCP tool', () => {
  it('calls the shared lookup with the authenticated actor and returns the CSV payload', async () => {
    const registered = tools()
    const tool = registered.get('crm_line_type_lookup')
    expect(tool?.description).toContain('phones')
    expect(tool?.description).toContain('line_status')
    expect(tool?.description).toContain('line_status_error')
    expect(tool?.description).toContain('1,000')
    expect(tool?.description).toContain('$0.015')

    const result = await tool?.handler(
      { phones: ['8165550100'] },
      { authInfo: { extra: { email: 'owner@savingkc.com' } }, requestId: 'rpc-1', sessionId: 'session-1' },
    )
    expect(mocks.run).toHaveBeenCalledWith({
      actor: OWNER,
      phones: ['8165550100'],
      threadId: 'session-1',
      requestId: 'rpc-1',
    })
    expect(result?.isError).toBeUndefined()
    expect(JSON.parse(result?.content[0]?.text ?? '{}')).toMatchObject({
      ok: true,
      usage: { usedToday: 1, remaining: 999 },
    })
  })

  it('returns the daily cap payload as a tool error and does not hide the counts', async () => {
    mocks.run.mockResolvedValue({
      status: 429,
      body: { ok: false, error: 'daily_lookup_cap', usage: { usedToday: 1000, remaining: 0, counted: 0 } },
    })
    const tool = tools().get('crm_line_type_lookup')
    const result = await tool?.handler(
      { phones: ['8165550100'] },
      { authInfo: { extra: { email: 'owner@savingkc.com' } }, requestId: 'rpc-2' },
    )
    expect(result?.isError).toBe(true)
    expect(JSON.parse(result?.content[0]?.text ?? '{}')).toMatchObject({
      error: 'daily_lookup_cap',
      usage: { usedToday: 1000, remaining: 0 },
    })
  })

  it('rejects an unauthenticated caller before the lookup', async () => {
    const tool = tools().get('crm_line_type_lookup')
    const result = await tool?.handler({ phones: ['8165550100'] }, { requestId: 'rpc-3' })
    expect(result?.isError).toBe(true)
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
