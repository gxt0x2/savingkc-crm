import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ auth: vi.fn(), execute: vi.fn() }))
vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/workflow-runs', () => ({
  executeNextWorkflowRun: mocks.execute,
  workflowRunPayload: (value: unknown) => value && typeof value === 'object' ? value : {},
}))

import { POST } from './route'

describe('workflow run worker', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue(null)
    mocks.execute.mockReset().mockResolvedValue(null)
  })

  it('exits before claiming work when unauthorized', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await POST(new Request('https://crm.savingkc.com/api/workers/workflow-runs', { method: 'POST' }))
    expect(response.status).toBe(401)
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('caps batch execution and stops when the supported queue is empty', async () => {
    mocks.execute
      .mockResolvedValueOnce({ id: 'run-1', status: 'succeeded' })
      .mockResolvedValueOnce({ id: 'run-2', status: 'retry_scheduled' })
      .mockResolvedValueOnce(null)
    const response = await POST(new Request('https://crm.savingkc.com/api/workers/workflow-runs', {
      method: 'POST',
      body: JSON.stringify({ limit: 50 }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.execute).toHaveBeenCalledTimes(3)
    await expect(response.json()).resolves.toMatchObject({ processed: 2 })
  })
})
