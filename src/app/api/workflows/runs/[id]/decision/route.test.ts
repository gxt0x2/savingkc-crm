import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  actor: vi.fn(),
  decide: vi.fn(),
  execute: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/workflow-runs', () => ({
  decideWorkflowRun: mocks.decide,
  executeWorkflowRun: mocks.execute,
  workflowRunPayload: (value: unknown) => value && typeof value === 'object' ? value : {},
}))

import { POST } from './route'

describe('workflow decision route', () => {
  beforeEach(() => {
    mocks.auth.mockReset().mockResolvedValue(null)
    mocks.actor.mockReset().mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.decide.mockReset().mockResolvedValue({ id: 'run-1', status: 'queued' })
    mocks.execute.mockReset().mockResolvedValue({ id: 'run-1', status: 'succeeded' })
  })

  it('rejects an unauthorized decision before reading its body', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const request = new Request('https://crm.savingkc.com/api/workflows/runs/run-1/decision', {
      method: 'POST',
      body: '{not-json',
    })
    const response = await POST(request, { params: Promise.resolve({ id: 'run-1' }) })
    expect(response.status).toBe(401)
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it('uses the verified administrator identity and executes an approved queued run', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/workflows/runs/run-1/decision', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'run-1:approved:test' },
      body: JSON.stringify({ decision: 'approved', actor: 'Spoofed' }),
    }), { params: Promise.resolve({ id: 'run-1' }) })

    expect(response.status).toBe(200)
    expect(mocks.decide).toHaveBeenCalledWith(expect.objectContaining({
      runId: 'run-1',
      decision: 'approved',
      actor: 'Ernest',
      idempotencyKey: 'run-1:approved:test',
    }))
    expect(mocks.execute).toHaveBeenCalledWith('run-1', 'approval:ernest@savingkc.com')
    await expect(response.json()).resolves.toEqual({ run: { id: 'run-1', status: 'succeeded' } })
  })

  it('records a rejection without running the executor', async () => {
    mocks.decide.mockResolvedValue({ id: 'run-1', status: 'rejected' })
    const response = await POST(new Request('https://crm.savingkc.com/api/workflows/runs/run-1/decision', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'run-1:rejected:test' },
      body: JSON.stringify({ decision: 'rejected' }),
    }), { params: Promise.resolve({ id: 'run-1' }) })
    expect(response.status).toBe(200)
    expect(mocks.execute).not.toHaveBeenCalled()
  })
})
