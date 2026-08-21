import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  requireUser: vi.fn(),
  actor: vi.fn(),
  build: vi.fn(),
  read: vi.fn(),
  save: vi.fn(),
  db: {},
}))

vi.mock('@/lib/api/admin-auth', () => ({
  requireAdminOrSecret: mocks.requireAdmin,
  requireUserOrSecret: mocks.requireUser,
}))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mocks.db }))
vi.mock('@/lib/operating-model/workflow-catalog', () => ({ WORKFLOW_CATALOG: [] }))
vi.mock('@/lib/operating-model/workflow-store', () => ({
  WORKFLOW_CATEGORIES: ['reporting'],
  buildWorkflowDraft: mocks.build,
  readStoredWorkflowDefinitions: mocks.read,
  saveWorkflowDraft: mocks.save,
}))

import { GET, POST } from './route'

describe('workflow definitions API', () => {
  beforeEach(() => {
    mocks.requireAdmin.mockReset().mockResolvedValue(null)
    mocks.requireUser.mockReset().mockResolvedValue(null)
    mocks.actor.mockReset().mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.read.mockReset().mockResolvedValue([])
    mocks.save.mockReset().mockResolvedValue(undefined)
    mocks.build.mockReset().mockReturnValue({
      definition: { id: 'draft-1' },
      governance: { createdBy: 'Ernest', createdAt: 'now', updatedAt: 'now', rollbackPlan: 'Pause it' },
    })
  })

  it('keeps registry reads available to authenticated users', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/workflows/definitions'))
    expect(response.status).toBe(200)
    expect(mocks.requireUser).toHaveBeenCalledOnce()
    expect(mocks.requireAdmin).not.toHaveBeenCalled()
  })

  it('rejects non-admin draft creation before parsing or storing', async () => {
    mocks.requireAdmin.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const request = new Request('https://crm.savingkc.com/api/workflows/definitions', { method: 'POST', body: '{invalid' })
    const response = await POST(request)
    expect(response.status).toBe(401)
    expect(mocks.build).not.toHaveBeenCalled()
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('ignores client actor identity and stamps the verified server actor', async () => {
    const body = { name: 'Draft', actor: 'Spoofed' }
    const response = await POST(new Request('https://crm.savingkc.com/api/workflows/definitions', {
      method: 'POST', body: JSON.stringify(body),
    }))
    expect(response.status).toBe(201)
    expect(mocks.build).toHaveBeenCalledWith(body, 'Ernest')
    expect(mocks.save).toHaveBeenCalledOnce()
  })
})
