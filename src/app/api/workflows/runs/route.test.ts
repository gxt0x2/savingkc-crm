import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  find: vi.fn(),
  supports: vi.fn(),
  list: vi.fn(),
  start: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/workflow-runs', () => ({
  findActiveWorkflowDefinition: mocks.find,
  supportsWorkflowExecution: mocks.supports,
  listWorkflowRuns: mocks.list,
  startWorkflowRun: mocks.start,
  executeWorkflowRun: mocks.execute,
  workflowRunPayload: (value: unknown) => value && typeof value === 'object' ? value : {},
}))

import { GET, POST } from './route'

const definition = {
  id: 'workflow-registry-health',
  status: 'active',
  version: 1,
  implementation: { mutatesData: false, approvalPolicy: 'automatic' },
}

const queued = { id: '10000000-0000-4000-8000-000000000001', status: 'queued' }
const succeeded = { ...queued, status: 'succeeded', output: { healthy: true } }

describe('workflow runs API', () => {
  beforeEach(() => {
    mocks.actor.mockReset().mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.find.mockReset().mockReturnValue(definition)
    mocks.supports.mockReset().mockReturnValue(true)
    mocks.list.mockReset().mockResolvedValue([])
    mocks.start.mockReset().mockResolvedValue(queued)
    mocks.execute.mockReset().mockResolvedValue(succeeded)
  })

  it('rejects unauthenticated reads before querying run history', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new Request('https://crm.savingkc.com/api/workflows/runs'))
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('lists bounded run history for a verified actor', async () => {
    await GET(new Request('https://crm.savingkc.com/api/workflows/runs?limit=8'))
    expect(mocks.list).toHaveBeenCalledWith(8)
  })

  it('requires an explicit idempotency key before creating a run', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/workflows/runs', {
      method: 'POST',
      body: JSON.stringify({ workflowId: 'workflow-registry-health' }),
    }))
    expect(response.status).toBe(400)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('does not create runs for catalog entries without an approved executor', async () => {
    mocks.supports.mockReturnValue(false)
    const response = await POST(new Request('https://crm.savingkc.com/api/workflows/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'unsupported:test' },
      body: JSON.stringify({ workflowId: 'ppc-conversion-export' }),
    }))
    expect(response.status).toBe(409)
    expect(mocks.start).not.toHaveBeenCalled()
  })

  it('uses the server-owned actor, executes the approved run, and returns provenance', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/workflows/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'registry-health:test' },
      body: JSON.stringify({ workflowId: 'workflow-registry-health', actor: 'Spoofed', input: { source: 'manual' } }),
    }))
    expect(response.status).toBe(202)
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'Ernest',
      idempotencyKey: 'registry-health:test',
      triggerKey: 'user:ernest@savingkc.com',
      payload: { source: 'manual' },
    }))
    expect(mocks.execute).toHaveBeenCalledWith(queued.id, 'interactive:ernest@savingkc.com')
    await expect(response.json()).resolves.toEqual({ run: succeeded })
  })
})
