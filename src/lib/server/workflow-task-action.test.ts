import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { executeApprovedFollowUpTask, prepareApprovedFollowUpInput, WorkflowInputError } from './workflow-task-action'

const LEAD_ID = '10000000-0000-4000-8000-000000000001'
const NOW = new Date('2026-08-21T15:00:00.000Z')

describe('approved follow-up workflow action', () => {
  it('canonicalizes the exact approved task contract and ignores client-owned governance fields', () => {
    expect(prepareApprovedFollowUpInput({
      leadId: LEAD_ID.toUpperCase(),
      title: '  Call seller after title review  ',
      notes: '  Confirm payoff timing.  ',
      dueAt: '2026-08-22T10:00:00-05:00',
      assignedTo: 'casey',
      kind: 'callback',
      department: 'tc',
      role: 'admin',
      priority: 'urgent',
    }, 'Ernest', NOW)).toEqual({
      leadId: LEAD_ID,
      title: 'Call seller after title review',
      notes: 'Confirm payoff timing.',
      dueAt: '2026-08-22T15:00:00.000Z',
      assignedTo: 'Casey',
      kind: 'callback',
      department: 'acquisitions',
      role: 'setter',
      priority: 'normal',
      primaryNextAction: false,
    })
  })

  it.each([
    [{ title: 'Call seller', dueAt: '2026-08-22T10:00:00-05:00' }, 'Select a valid CRM contact.'],
    [{ leadId: LEAD_ID, title: 'x', dueAt: '2026-08-22T10:00:00-05:00' }, 'Title must be between'],
    [{ leadId: LEAD_ID, title: 'Call seller', dueAt: 'not-a-date' }, 'Enter a valid due date.'],
    [{ leadId: LEAD_ID, title: 'Call seller', dueAt: '2026-08-20T10:00:00-05:00' }, 'Due date must be between now'],
    [{ leadId: LEAD_ID, title: 'Call seller', dueAt: '2026-08-22T10:00:00-05:00', assignedTo: 'Spoofed User' }, 'Choose an approved task owner.'],
  ])('rejects invalid mutating input before a run exists', (input, expected) => {
    expect(() => prepareApprovedFollowUpInput(input, 'Ernest', NOW)).toThrow(expected)
    try {
      prepareApprovedFollowUpInput(input, 'Ernest', NOW)
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowInputError)
      expect((error as WorkflowInputError).retryable).toBe(false)
    }
  })

  it('creates through the provenance-aware idempotent work-item RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        created: true,
        workItem: {
          work_item_key: 'activity:20000000-0000-4000-8000-000000000001',
          source_kind: 'activity',
          source_id: '20000000-0000-4000-8000-000000000001',
          lead_id: LEAD_ID,
          tc_file_id: null,
          kind: 'follow_up',
          title: 'Call seller',
          description: null,
          status: 'pending',
          priority: 'normal',
          due_at: '2026-08-22T15:00:00.000Z',
          assigned_to: 'Ernest',
          department: 'acquisitions',
          role: 'setter',
          primary_next_action: false,
          version: 1,
          source_created_at: NOW.toISOString(),
          completed_at: null,
          updated_at: NOW.toISOString(),
        },
      },
      error: null,
    })

    const result = await executeApprovedFollowUpTask({
      runId: '30000000-0000-4000-8000-000000000001',
      workflowVersion: 1,
      definitionHash: 'a'.repeat(64),
      triggerKind: 'manual',
      requestedBy: 'Ernest',
      payload: {
        leadId: LEAD_ID,
        title: 'Call seller',
        dueAt: '2026-08-22T15:00:00.000Z',
        assignedTo: 'Ernest',
      },
    }, { rpc } as unknown as SupabaseClient)

    expect(result.created).toBe(true)
    expect(rpc).toHaveBeenCalledWith('create_work_item_v2', expect.objectContaining({
      p_idempotency_key: '30000000-0000-4000-8000-000000000001:create-follow-up-task',
      p_lead_id: LEAD_ID,
      p_provenance: expect.objectContaining({
        source: 'governed_workflow',
        workflow_id: 'approved-follow-up-task',
        workflow_run_id: '30000000-0000-4000-8000-000000000001',
      }),
    }))
  })
})
