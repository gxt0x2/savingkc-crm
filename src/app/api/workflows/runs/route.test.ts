import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  find: vi.fn(),
  supports: vi.fn(),
  list: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
  execute: vi.fn(),
  verifyAi: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/workflow-runs', () => ({
  findActiveWorkflowDefinition: mocks.find,
  supportsWorkflowExecution: mocks.supports,
  listWorkflowRuns: mocks.list,
  prepareWorkflowRunInput: mocks.prepare,
  startWorkflowRun: mocks.start,
  SUPPORTED_WORKFLOW_EXECUTORS: ['workflow-registry-health', 'approved-follow-up-task'],
  executeWorkflowRun: mocks.execute,
  workflowRunPayload: (value: unknown) => value && typeof value === 'object' ? value : {},
}))
vi.mock('@/lib/server/workflow-task-action', () => ({
  APPROVED_FOLLOW_UP_WORKFLOW_ID: 'approved-follow-up-task',
  WorkflowInputError: class WorkflowInputError extends Error {},
  verifyNextActionGeneration: mocks.verifyAi,
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
    mocks.prepare.mockReset().mockImplementation((_workflowId, value) => value || {})
    mocks.start.mockReset().mockResolvedValue(queued)
    mocks.execute.mockReset().mockResolvedValue(succeeded)
    mocks.verifyAi.mockReset().mockResolvedValue(null)
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
      maxAttempts: 3,
    }))
    expect(mocks.execute).toHaveBeenCalledWith(queued.id, 'interactive:ernest@savingkc.com')
    await expect(response.json()).resolves.toEqual({ run: succeeded })
  })

  it('stores the server-canonicalized mutating input and waits for approval', async () => {
    const awaiting = { id: '20000000-0000-4000-8000-000000000001', status: 'awaiting_approval' }
    mocks.find.mockReturnValue({
      id: 'approved-follow-up-task',
      status: 'active',
      version: 1,
      implementation: { mutatesData: true, approvalPolicy: 'user_confirmation' },
    })
    mocks.prepare.mockReturnValue({
      leadId: '10000000-0000-4000-8000-000000000001',
      title: 'Call seller',
      assignedTo: 'Casey',
      dueAt: '2026-08-22T15:00:00.000Z',
      department: 'acquisitions',
    })
    mocks.start.mockResolvedValue(awaiting)

    const response = await POST(new Request('https://crm.savingkc.com/api/workflows/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'approved-task:test' },
      body: JSON.stringify({
        workflowId: 'approved-follow-up-task',
        maxAttempts: 10,
        input: { title: 'client value', department: 'tc' },
      }),
    }))

    expect(response.status).toBe(202)
    expect(mocks.prepare).toHaveBeenCalledWith('approved-follow-up-task', { title: 'client value', department: 'tc' }, 'Ernest')
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({ department: 'acquisitions' }),
      maxAttempts: 3,
    }))
    expect(mocks.execute).not.toHaveBeenCalled()
  })

  it('verifies AI provenance against the actor and contact before storing it', async () => {
    const awaiting = { id: '20000000-0000-4000-8000-000000000001', status: 'awaiting_approval' }
    mocks.find.mockReturnValue({
      id: 'approved-follow-up-task', status: 'active', version: 1,
      implementation: { mutatesData: true, approvalPolicy: 'user_confirmation' },
    })
    mocks.prepare.mockReturnValue({
      leadId: '10000000-0000-4000-8000-000000000001', title: 'Call seller',
      assignedTo: 'Casey', dueAt: '2026-08-22T15:00:00.000Z', department: 'acquisitions',
    })
    mocks.verifyAi.mockResolvedValue({
      aiGenerationId: '30000000-0000-4000-8000-000000000001',
      aiEvidenceIds: ['activity:source-1'],
      aiSources: [{ name: 'Call activity', url: 'https://crm.savingkc.com/leads/10000000-0000-4000-8000-000000000001?section=activity', detail: 'Seller requested a callback.' }],
      aiModel: 'openai/gpt-5.6-luna',
      aiPromptVersion: 'next-action-proposal-v1',
      aiRationale: 'Seller requested a family-review callback.',
      aiConfidence: 'high',
    })
    mocks.start.mockResolvedValue(awaiting)

    const response = await POST(new Request('https://crm.savingkc.com/api/workflows/runs', {
      method: 'POST',
      headers: { 'Idempotency-Key': 'approved-ai-task:test' },
      body: JSON.stringify({
        workflowId: 'approved-follow-up-task',
        input: { aiGenerationId: '30000000-0000-4000-8000-000000000001' },
      }),
    }))

    expect(response.status).toBe(202)
    expect(mocks.verifyAi).toHaveBeenCalledWith({
      generationId: '30000000-0000-4000-8000-000000000001',
      actorEmail: 'ernest@savingkc.com',
      leadId: '10000000-0000-4000-8000-000000000001',
    })
    expect(mocks.start).toHaveBeenCalledWith(expect.objectContaining({
      payload: expect.objectContaining({
        aiGenerationId: '30000000-0000-4000-8000-000000000001',
        aiPromptVersion: 'next-action-proposal-v1',
      }),
    }))
  })
})
