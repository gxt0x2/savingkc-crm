import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const mocks = vi.hoisted(() => {
  class MockWorkItemError extends Error {
    constructor(message: string, readonly code: 'unavailable' | 'invalid' | 'not_found' | 'conflict') {
      super(message)
    }
  }
  return { createWorkItem: vi.fn(), WorkItemError: MockWorkItemError }
})

vi.mock('@/lib/server/work-items', () => ({
  createWorkItem: mocks.createWorkItem,
  WorkItemError: mocks.WorkItemError,
}))

import {
  executeSellerIntakeWorkflow,
  prepareSellerIntakeWorkflowPayload,
  SellerIntakeWorkflowError,
} from './seller-intake-workflow-action'

const RUN_ID = '10000000-0000-4000-8000-000000000001'
const LEAD_ID = '10000000-0000-4000-8000-000000000002'
const TRIGGER_KEY = 'seller-form-intake:0123456789abcdef01234567'

function payload() {
  return {
    leadId: LEAD_ID,
    formSource: 'website_form',
    workflowTriggerKey: TRIGGER_KEY,
    identityKeys: ['phone:+18165551212', 'email:seller@example.com'],
    dueAt: '2026-08-24T15:05:00.000Z',
    acknowledgementAllowed: true,
    acknowledgementReason: 'consent_granted',
  }
}

function database(
  lookups: Array<{ data: { id: string } | null; error: { message: string } | null }> = [
    { data: null, error: null },
    { data: null, error: null },
  ],
  primary: { data: { work_item_key: string } | null; error: { message: string } | null } = { data: null, error: null },
  owner: { data: { assigned_agent: string | null } | null; error: { message: string } | null } = {
    data: { assigned_agent: null },
    error: null,
  },
) {
  const maybeSingle = vi.fn()
  for (const result of lookups) maybeSingle.mockResolvedValueOnce(result)
  const primaryMaybeSingle = vi.fn().mockResolvedValue(primary)
  const ownerMaybeSingle = vi.fn().mockResolvedValue(owner)
  const statusSingle = vi.fn().mockResolvedValue({ data: { id: 'status-activity-1' }, error: null })
  const insert = vi.fn(() => ({ select: () => ({ single: statusSingle }) }))
  const from = vi.fn((table: string) => {
    if (table === 'leads') {
      return { select: () => ({ eq: () => ({ maybeSingle: ownerMaybeSingle }) }) }
    }
    if (table === 'work_items') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                in: () => ({ limit: () => ({ maybeSingle: primaryMaybeSingle }) }),
              }),
            }),
          }),
        }),
      }
    }
    return {
      select: () => ({
          eq: () => ({
            eq: () => ({
              contains: () => ({
                limit: () => ({ maybeSingle }),
              }),
            }),
          }),
      }),
      insert,
    }
  })
  return { db: { from } as unknown as SupabaseClient, from, insert, statusSingle }
}

describe('seller intake governed workflow action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createWorkItem.mockResolvedValue({
      created: true,
      workItem: { key: 'activity:task-1' },
    })
  })

  it('rejects malformed event evidence before writing', () => {
    expect(() => prepareSellerIntakeWorkflowPayload({ ...payload(), leadId: 'not-a-uuid' }))
      .toThrow(SellerIntakeWorkflowError)
    expect(() => prepareSellerIntakeWorkflowPayload({ ...payload(), workflowTriggerKey: 'seller-form-intake:guess' }))
      .toThrow(SellerIntakeWorkflowError)
    expect(() => prepareSellerIntakeWorkflowPayload({ ...payload(), acknowledgementReason: 'guessed' }))
      .toThrow(SellerIntakeWorkflowError)
    expect(() => prepareSellerIntakeWorkflowPayload({
      ...payload(),
      acknowledgementAllowed: true,
      acknowledgementReason: 'consent_missing',
    })).toThrow(SellerIntakeWorkflowError)
  })

  it('rejects an unverified execution envelope before reading CRM data', async () => {
    const from = vi.fn()
    await expect(executeSellerIntakeWorkflow({
      runId: RUN_ID,
      workflowVersion: 1,
      definitionHash: 'a'.repeat(64),
      triggerKind: 'manual',
      requestedBy: 'Unknown automation',
      payload: payload(),
    }, { from } as unknown as SupabaseClient)).rejects.toBeInstanceOf(SellerIntakeWorkflowError)
    expect(from).not.toHaveBeenCalled()
  })

  it('creates one canonical work item with workflow provenance, then records the intake event', async () => {
    const { db, insert } = database()
    const result = await executeSellerIntakeWorkflow({
      runId: RUN_ID,
      workflowVersion: 2,
      definitionHash: 'a'.repeat(64),
      triggerKind: 'lead_form_submitted',
      requestedBy: 'SavingKC Operations',
      payload: payload(),
    }, db)

    expect(result).toMatchObject({
      created: true,
      leadId: LEAD_ID,
      workItemKey: 'activity:task-1',
      owner: null,
      assignmentRequired: true,
      statusActivityId: 'status-activity-1',
    })
    expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: `${RUN_ID}:seller-intake-primary`,
      leadId: LEAD_ID,
      kind: 'task',
      title: 'Make first contact',
      assignedTo: null,
      department: 'acquisitions',
      primaryNextAction: true,
      provenance: expect.objectContaining({
        event_backed: true,
        event_type: 'lead_form_submitted',
        workflow_id: 'seller-form-intake',
        workflow_run_id: RUN_ID,
        workflow_trigger_key: TRIGGER_KEY,
      }),
    }), db)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      activity_type: 'status_change',
      metadata: expect.objectContaining({
        workflow_run_id: RUN_ID,
        conversation_attention: 'needs_reply',
        acknowledgement_allowed: true,
        owner_kind: 'team_queue',
        owner_name: null,
        assignment_required: true,
      }),
    }))
    expect(insert).not.toHaveBeenCalledWith(expect.objectContaining({ activity_type: 'task' }))
  })

  it('recognizes a legacy deterministic event and does not duplicate its task', async () => {
    const { db, insert } = database([
      { data: null, error: null },
      { data: { id: 'legacy-status-1' }, error: null },
    ])
    const result = await executeSellerIntakeWorkflow({
      runId: RUN_ID,
      workflowVersion: 2,
      definitionHash: 'a'.repeat(64),
      triggerKind: 'lead_form_submitted',
      requestedBy: 'SavingKC Operations',
      payload: payload(),
    }, db)

    expect(result).toMatchObject({ created: false, legacyCompatible: true, statusActivityId: 'legacy-status-1' })
    expect(mocks.createWorkItem).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })

  it('reuses an existing canonical primary action while preserving the new intake event', async () => {
    const { db, insert } = database(undefined, {
      data: { work_item_key: 'activity:existing-primary' },
      error: null,
    })
    const result = await executeSellerIntakeWorkflow({
      runId: RUN_ID,
      workflowVersion: 2,
      definitionHash: 'a'.repeat(64),
      triggerKind: 'lead_form_submitted',
      requestedBy: 'SavingKC Operations',
      payload: payload(),
    }, db)

    expect(result).toMatchObject({ created: false, workItemKey: 'activity:existing-primary' })
    expect(mocks.createWorkItem).not.toHaveBeenCalled()
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ activity_type: 'status_change' }))
  })

  it('assigns the first action only when a factual human owner already exists', async () => {
    const { db, insert } = database(undefined, undefined, { data: { assigned_agent: 'Casey' }, error: null })

    const result = await executeSellerIntakeWorkflow({
      runId: RUN_ID,
      workflowVersion: 2,
      definitionHash: 'a'.repeat(64),
      triggerKind: 'lead_form_submitted',
      requestedBy: 'SavingKC Operations',
      payload: payload(),
    }, db)

    expect(result).toMatchObject({ owner: 'Casey', assignmentRequired: false })
    expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'Casey' }), db)
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ owner_kind: 'agent', owner_name: 'Casey', assignment_required: false }),
    }))
  })

  it('keeps a department label in the team queue instead of treating it as a person', async () => {
    const { db } = database(undefined, undefined, { data: { assigned_agent: 'Acquisitions' }, error: null })

    const result = await executeSellerIntakeWorkflow({
      runId: RUN_ID,
      workflowVersion: 2,
      definitionHash: 'a'.repeat(64),
      triggerKind: 'lead_form_submitted',
      requestedBy: 'SavingKC Operations',
      payload: payload(),
    }, db)

    expect(result).toMatchObject({ owner: null, assignmentRequired: true })
    expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      assignedTo: null,
      department: 'acquisitions',
    }), db)
  })

  it('fails closed when the owner source cannot be read', async () => {
    const { db, insert } = database(undefined, undefined, {
      data: null,
      error: { message: 'owner query unavailable' },
    })

    await expect(executeSellerIntakeWorkflow({
      runId: RUN_ID,
      workflowVersion: 2,
      definitionHash: 'a'.repeat(64),
      triggerKind: 'lead_form_submitted',
      requestedBy: 'SavingKC Operations',
      payload: payload(),
    }, db)).rejects.toThrow('Seller intake owner lookup failed')
    expect(mocks.createWorkItem).not.toHaveBeenCalled()
    expect(insert).not.toHaveBeenCalled()
  })
})
