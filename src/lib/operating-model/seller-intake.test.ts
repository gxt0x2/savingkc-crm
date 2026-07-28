import { beforeEach, describe, expect, it, vi } from 'vitest'

const maybeSingle = vi.fn()
const insert = vi.fn()

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            contains: vi.fn(() => ({ maybeSingle })),
          })),
        })),
      })),
      insert,
    })),
  },
}))

import { buildSellerIntakePlan, recordSellerIntakeOperatingState } from './seller-intake'

describe('seller intake operating model', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    maybeSingle.mockResolvedValue({ data: null, error: null })
    insert.mockResolvedValue({ error: null })
  })

  it('creates a stable five-minute primary action and respects missing SMS consent', () => {
    const submittedAt = new Date('2026-07-28T15:00:00.000Z')
    const plan = buildSellerIntakePlan({
      leadId: 'lead-1',
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

  it('uses a deterministic workflow run id for retries of the same submission', () => {
    const input = {
      leadId: 'lead-1',
      formSource: 'ppc_form_submit',
      submissionKey: 'session-1',
      phone: '+18165551212',
      smsConsent: true,
    }

    expect(buildSellerIntakePlan(input).workflowRunId)
      .toBe(buildSellerIntakePlan(input).workflowRunId)
  })

  it('does not create duplicate operating state for an existing workflow run', async () => {
    maybeSingle.mockResolvedValue({ data: { id: 'activity-1' }, error: null })

    const result = await recordSellerIntakeOperatingState({
      leadId: 'lead-1',
      formSource: 'website',
      submissionKey: 'session-1',
      smsConsent: true,
    })

    expect(result.created).toBe(false)
    expect(insert).not.toHaveBeenCalled()
  })

  it('writes the workflow state and primary action together', async () => {
    const result = await recordSellerIntakeOperatingState({
      leadId: 'lead-1',
      formSource: 'website',
      submissionKey: 'session-1',
      phone: '+18165551212',
      smsConsent: true,
      submittedAt: new Date('2026-07-28T15:00:00.000Z'),
    })

    expect(result.created).toBe(true)
    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        activity_type: 'status_change',
        metadata: expect.objectContaining({
          opportunity_stage: 'new',
          conversation_attention: 'needs_reply',
          acknowledgement_allowed: true,
        }),
      }),
      expect.objectContaining({
        activity_type: 'task',
        metadata: expect.objectContaining({
          due_date: '2026-07-28T15:05:00.000Z',
          status: 'pending',
          primary_next_action: true,
        }),
      }),
    ])
  })
})
