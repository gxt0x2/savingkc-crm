import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const mocks = vi.hoisted(() => ({
  resolveActor: vi.fn(),
  listOpenAndons: vi.fn(),
  getAndon: vi.fn(),
  updateAndonStatus: vi.fn(),
  setAndonAssignee: vi.fn(),
  addAndonNote: vi.fn(),
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

const ANDON_ID = '9675d05a-5661-4bda-b528-1d98f3e95633'

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

describe('assistant Andon write API', () => {
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
      writeScope: 'andon_only',
      andon: { id: ANDON_ID, status: 'acknowledged' },
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
    expect(await response.json()).toMatchObject({ error: 'Andon write requires an owner or admin profile' })
    expect(mocks.listOpenAndons).not.toHaveBeenCalled()
  })

  it('rejects unknown actions', async () => {
    const response = await POST(request({ action: 'update_lead_stage', leadId: ANDON_ID }))

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'Invalid request' })
    expect(mocks.updateAndonStatus).not.toHaveBeenCalled()
    expect(mocks.setAndonAssignee).not.toHaveBeenCalled()
  })

  it('allows an owner to update Andon status only', async () => {
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
      writeScope: 'andon_only',
      action: 'update_andon_status',
      andon: { id: ANDON_ID, status: 'acknowledged' },
    })
    expect(mocks.updateAndonStatus).toHaveBeenCalledWith(expect.anything(), ANDON_ID, 'acknowledged')
  })

  it('never names lead, dialer, or money tables in the write surface', () => {
    const route = readFileSync('src/app/api/assistant/write/route.ts', 'utf8')
    const writes = readFileSync('src/lib/assistant/andon-write.ts', 'utf8')
    for (const source of [route, writes]) {
      expect(source).not.toMatch(/\.from\(['"]leads['"]\)/)
      expect(source).not.toMatch(/\.from\(['"]dispo_deals['"]\)/)
      expect(source).not.toMatch(/\.from\(['"]mojo_call_queue['"]\)/)
      expect(source).not.toMatch(/\.from\(['"]dialer_sessions['"]\)/)
    }
    expect(writes).toContain("export const ANDON_TABLE = 'feedback_submissions'")
  })
})
