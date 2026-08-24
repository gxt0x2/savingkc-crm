import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  findDefinition: vi.fn(),
  startRun: vi.fn(),
  executeRun: vi.fn(),
}))

vi.mock('@/lib/server/workflow-runs', () => ({
  findActiveWorkflowDefinition: mocks.findDefinition,
  startWorkflowRun: mocks.startRun,
  executeWorkflowRun: mocks.executeRun,
}))

import { buildSellerIntakePlan, recordSellerIntakeOperatingState } from './seller-intake'

const RUN_ID = '10000000-0000-4000-8000-000000000001'
const LEAD_ID = '10000000-0000-4000-8000-000000000002'

describe('seller intake operating model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.findDefinition.mockReturnValue({ id: 'seller-form-intake', version: 2 })
    mocks.startRun.mockResolvedValue({ id: RUN_ID, status: 'queued', output: null })
    mocks.executeRun.mockResolvedValue({ id: RUN_ID, status: 'succeeded', output: { created: true } })
  })

  it('creates a stable five-minute primary action and respects missing SMS consent', () => {
    const submittedAt = new Date('2026-07-28T15:00:00.000Z')
    const plan = buildSellerIntakePlan({
      leadId: LEAD_ID,
      formSource: 'website',
      submissionKey: 'session-1',
      phone: '+18165551212',
      email: 'SELLER@example.com ',
      address: ' 123 Main St ',
      smsConsent: false,
      submittedAt,
    })

    expect(plan.nextAction).toMatchObject({
      title: 'Make first contact',
      dueAt: '2026-07-28T15:05:00.000Z',
      primary: true,
    })
    expect(plan.owner).toMatchObject({ kind: 'team', id: 'acquisitions' })
    expect(plan.conversationAttention).toBe('needs_reply')
    expect(plan.acknowledgement).toMatchObject({
      allowed: false,
      reason: 'consent_missing',
      handledByExistingRoute: true,
    })
    expect(plan.identityKeys).toEqual([
      'phone:+18165551212',
      'email:seller@example.com',
      'address:123 main st',
    ])
  })

  it('uses a deterministic workflow trigger key for retries of the same submission', () => {
    const input = {
      leadId: LEAD_ID,
      formSource: 'ppc_form_submit',
      submissionKey: 'session-1',
      phone: '+18165551212',
      smsConsent: true,
    }

    expect(buildSellerIntakePlan(input).workflowTriggerKey)
      .toBe(buildSellerIntakePlan(input).workflowTriggerKey)
  })

  it('returns the durable existing outcome without executing a duplicate run', async () => {
    mocks.startRun.mockResolvedValue({ id: RUN_ID, status: 'succeeded', output: { created: false } })

    const result = await recordSellerIntakeOperatingState({
      leadId: LEAD_ID,
      formSource: 'website',
      submissionKey: 'session-1',
      smsConsent: true,
    })

    expect(result).toMatchObject({ created: false, queued: false, workflowRunId: RUN_ID })
    expect(mocks.executeRun).not.toHaveBeenCalled()
  })

  it('starts and immediately attempts the governed event-backed workflow', async () => {
    const result = await recordSellerIntakeOperatingState({
      leadId: LEAD_ID,
      formSource: 'website',
      submissionKey: 'session-1',
      phone: '+18165551212',
      smsConsent: true,
      submittedAt: new Date('2026-07-28T15:00:00.000Z'),
    })

    expect(result).toMatchObject({ created: true, queued: false, workflowRunId: RUN_ID })
    expect(mocks.startRun).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'SavingKC Operations',
      idempotencyKey: expect.stringMatching(/^seller-form-intake:/),
      verifiedServerEvent: 'seller_intake',
      triggerKind: 'lead_form_submitted',
      triggerKey: expect.stringMatching(/^seller-form-intake:/),
      payload: expect.objectContaining({
        leadId: LEAD_ID,
        dueAt: '2026-07-28T15:05:00.000Z',
        acknowledgementAllowed: true,
      }),
    }))
    expect(mocks.executeRun).toHaveBeenCalledWith(RUN_ID)
  })

  it('contains no direct task-shaped activity write', () => {
    const source = readFileSync('src/lib/operating-model/seller-intake.ts', 'utf8')
    expect(source).not.toContain(".from('lead_activities')")
    expect(source).not.toMatch(/activity_type\s*:\s*['"]task['"]/)
  })
})
