import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolve: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@/lib/assistant/auth', () => ({
  resolveAssistantActor: mocks.resolve,
  assistantActorCanReadCompanyWide: (actor: { access: string }) => actor.access === 'owner' || actor.access === 'admin',
}))

vi.mock('@/lib/server/line-type-lookup', () => ({
  runLineTypeLookup: mocks.run,
}))

import { POST } from './route'

const OWNER = { email: 'owner@savingkc.com', fullName: 'Owner', role: 'owner', access: 'owner' }

function request(body: unknown, token = 'configured-secret') {
  return new Request('https://crm.savingkc.com/api/ops/line-type-lookup', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('CRM_MCP_TOKEN', 'configured-secret')
  mocks.resolve.mockResolvedValue(OWNER)
  mocks.run.mockResolvedValue({
    status: 200,
    body: { ok: true, rows: [], csv: 'e164,valid,line_type,carrier,checked_at\n', usage: { counted: 0 } },
  })
})

describe('POST /api/ops/line-type-lookup', () => {
  it('uses the CRM MCP bearer and does not look up numbers until that passes', async () => {
    const response = await POST(request({ phones: ['8165550100'] }))
    expect(response.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      actor: OWNER,
      phones: ['8165550100'],
    }))
  })

  it('rejects a missing or incorrect MCP bearer before the lookup', async () => {
    const missing = await POST(new Request('https://crm.savingkc.com/api/ops/line-type-lookup', {
      method: 'POST',
      body: JSON.stringify({ phones: ['8165550100'] }),
    }))
    const wrong = await POST(request({ phones: ['8165550100'] }, 'wrong-secret'))
    expect(missing.status).toBe(401)
    expect(wrong.status).toBe(401)
    expect(mocks.resolve).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('rejects an agent profile', async () => {
    mocks.resolve.mockResolvedValue({ ...OWNER, access: 'agent' })
    const response = await POST(request({ phones: ['8165550100'] }))
    expect(response.status).toBe(403)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('rejects a body that is not JSON', async () => {
    const response = await POST(request('{'))
    expect(response.status).toBe(400)
    expect(mocks.run).not.toHaveBeenCalled()
  })
})
