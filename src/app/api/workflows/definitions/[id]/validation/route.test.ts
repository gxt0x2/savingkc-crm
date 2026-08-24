import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  read: vi.fn(),
  validate: vi.fn(),
  db: {},
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireUserOrSecret: mocks.requireUser }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mocks.db }))
vi.mock('@/lib/operating-model/workflow-store', () => ({
  readStoredWorkflowDefinition: mocks.read,
  validateStoredWorkflowDraft: mocks.validate,
}))

import { GET } from './route'

const context = (id: string) => ({ params: Promise.resolve({ id }) })

describe('workflow draft validation API', () => {
  beforeEach(() => {
    mocks.requireUser.mockReset().mockResolvedValue(null)
    mocks.read.mockReset().mockResolvedValue({ definition: { id: 'draft-1' }, governance: { createdAt: 'now' } })
    mocks.validate.mockReset().mockReturnValue({ workflowId: 'draft-1', mode: 'validation_only', readyForPublish: false })
  })

  it('rejects unauthenticated requests before reading the workflow registry', async () => {
    mocks.requireUser.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))

    const response = await GET(new Request('https://crm.savingkc.com/api/workflows/definitions/draft-1/validation'), context('draft-1'))

    expect(response.status).toBe(401)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('returns a private validation-only report for a stored draft', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/workflows/definitions/draft-1/validation'), context('draft-1'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toEqual({
      report: { workflowId: 'draft-1', mode: 'validation_only', readyForPublish: false },
    })
    expect(mocks.read).toHaveBeenCalledWith(mocks.db, 'draft-1')
    expect(mocks.validate).toHaveBeenCalledOnce()
  })

  it('rejects malformed identifiers before touching the database', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/workflows/definitions/bad/validation'), context('../bad'))

    expect(response.status).toBe(400)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('returns 404 when the stored draft does not exist', async () => {
    mocks.read.mockResolvedValue(null)

    const response = await GET(new Request('https://crm.savingkc.com/api/workflows/definitions/missing/validation'), context('missing'))

    expect(response.status).toBe(404)
    expect(mocks.validate).not.toHaveBeenCalled()
  })

  it('fails honestly without exposing database details', async () => {
    mocks.read.mockRejectedValue(new Error('relation system_config does not exist'))
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const response = await GET(new Request('https://crm.savingkc.com/api/workflows/definitions/draft-1/validation'), context('draft-1'))

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Workflow validation is unavailable.' })
    consoleError.mockRestore()
  })
})
