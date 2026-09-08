import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  listOpenAndons: vi.fn(),
  getAndon: vi.fn(),
  updateAndonStatus: vi.fn(),
  setAndonAssignee: vi.fn(),
  addAndonNote: vi.fn(),
  setAndonChatThread: vi.fn(),
  linkAndonRecord: vi.fn(),
  addLeadNote: vi.fn(),
  updateLeadStage: vi.fn(),
  auditInsert: vi.fn(),
}))

vi.mock('@/lib/assistant/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/assistant/auth')>()
  return { ...actual, resolveAssistantActor: mocks.resolveActor }
})

vi.mock('@/lib/assistant/andon-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/assistant/andon-write')>()
  return {
    ...actual,
    listOpenAndons: mocks.listOpenAndons,
    getAndon: mocks.getAndon,
    updateAndonStatus: mocks.updateAndonStatus,
    setAndonAssignee: mocks.setAndonAssignee,
    addAndonNote: mocks.addAndonNote,
    setAndonChatThread: mocks.setAndonChatThread,
    linkAndonRecord: mocks.linkAndonRecord,
  }
})

vi.mock('@/lib/assistant/ops-write', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/assistant/ops-write')>()
  return {
    ...actual,
    addLeadNote: mocks.addLeadNote,
    updateLeadStage: mocks.updateLeadStage,
  }
})

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      insert: (payload: unknown) => {
        mocks.auditInsert(payload)
        return { error: null }
      },
    }),
  }),
}))

import { POST } from './route'

const ANDON_ID = '00000000-0000-4000-8000-000000000001'
const LEAD_ID = '00000000-0000-4000-8000-000000000002'

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request('https://crm.savingkc.com/api/assistant/write', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-crm-assistant-secret': 'assistant-secret',
      'x-savingkc-user-email': 'ernest@savingkc.com',
      ...headers,
    },
    body: JSON.stringify(body),
  })
}

describe('assistant ops write API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CRM_ASSISTANT_API_SECRET', 'assistant-secret')
    vi.stubEnv('CRM_ASSISTANT_ALLOWED_EMAILS', 'ernest@savingkc.com,robin@savingkc.com')
    vi.stubEnv('CRM_ASSISTANT_OWNER_EMAILS', 'ernest@savingkc.com')
    mocks.resolveActor.mockResolvedValue({
      email: 'ernest@savingkc.com',
      fullName: 'Ernest',
      role: 'owner',
      access: 'owner',
    })
    mocks.updateAndonStatus.mockResolvedValue({
      action: 'update_andon_status',
      writeScope: 'ops_except_money',
      andon: { id: ANDON_ID, status: 'acknowledged' },
    })
    mocks.addLeadNote.mockResolvedValue({
      action: 'add_lead_note',
      writeScope: 'ops_except_money',
      leadId: LEAD_ID,
      note: { id: 'note-1', description: 'Call Casey' },
    })
  })

  it('rejects unauthorized requests before executing an action', async () => {
    const response = await POST(request({ action: 'update_andon_status', andonId: ANDON_ID, status: 'acknowledged' }, {
      'x-crm-assistant-secret': 'wrong-secret',
    }))

    expect(response.status).toBe(401)
    expect(mocks.resolveActor).not.toHaveBeenCalled()
    expect(mocks.updateAndonStatus).not.toHaveBeenCalled()
  })

  it('rejects emails outside the assistant allowlist', async () => {
    const response = await POST(request({ action: 'list_open_andons' }, {
      'x-savingkc-user-email': 'stranger@example.com',
    }))

    expect(response.status).toBe(401)
    expect(mocks.resolveActor).not.toHaveBeenCalled()
  })

  it('rejects agent profiles that are not owner or admin', async () => {
    mocks.resolveActor.mockResolvedValue({
      email: 'robin@savingkc.com',
      fullName: 'Robin',
      role: 'agent',
      access: 'agent',
    })

    const response = await POST(request({ action: 'list_open_andons' }, {
      'x-savingkc-user-email': 'robin@savingkc.com',
    }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Assistant write requires an owner or admin profile' })
    expect(mocks.listOpenAndons).not.toHaveBeenCalled()
  })

  it('rejects unknown actions', async () => {
    const response = await POST(request({ action: 'drain_mojo_call_queue' }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Invalid request' })
    expect(mocks.updateAndonStatus).not.toHaveBeenCalled()
  })

  it('rejects money writes without executing', async () => {
    const response = await POST(request({ action: 'update_assignment_fee', leadId: LEAD_ID, assignmentFee: 25000 }))

    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({ error: 'Money writes are not allowed', writeScope: 'ops_except_money' })
    expect(mocks.addLeadNote).not.toHaveBeenCalled()
    expect(mocks.updateLeadStage).not.toHaveBeenCalled()
  })

  it('allows an owner to update Andon status', async () => {
    const response = await POST(request({
      action: 'update_andon_status',
      andonId: ANDON_ID,
      status: 'acknowledged',
      requestId: 'req-andon-1',
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({
      requestId: 'req-andon-1',
      writeScope: 'ops_except_money',
      action: 'update_andon_status',
      andon: { id: ANDON_ID, status: 'acknowledged' },
    })
    expect(mocks.updateAndonStatus).toHaveBeenCalledWith(expect.anything(), ANDON_ID, 'acknowledged')
  })

  it('allows an operational lead note', async () => {
    const response = await POST(request({
      action: 'add_lead_note',
      leadId: LEAD_ID,
      note: 'Casey will recap the call.',
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      writeScope: 'ops_except_money',
      action: 'add_lead_note',
      leadId: LEAD_ID,
    })
    expect(mocks.addLeadNote).toHaveBeenCalled()
  })

  it('never names money, dialer queue, or treasury tables', () => {
    const sources = [
      readFileSync('src/app/api/assistant/write/route.ts', 'utf8'),
      readFileSync('src/lib/assistant/andon-write.ts', 'utf8'),
      readFileSync('src/lib/assistant/ops-write.ts', 'utf8'),
    ]
    for (const source of sources) {
      expect(source).not.toMatch(/\.from\(['"]crm_deal_ledger_lines['"]\)/)
      expect(source).not.toMatch(/\.from\(['"]revenue_transactions['"]\)/)
      expect(source).not.toMatch(/\.from\(['"]financial_summary['"]\)/)
      expect(source).not.toMatch(/\.from\(['"]mojo_call_queue['"]\)/)
    }
  })
})
