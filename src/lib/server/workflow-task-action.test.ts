import { describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  executeApprovedFollowUpTask,
  prepareApprovedFollowUpInput,
  verifyNextActionGeneration,
  WorkflowInputError,
} from './workflow-task-action'

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

  it('verifies AI provenance against the generation actor, contact, and persisted evidence', async () => {
    const generationQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: '30000000-0000-4000-8000-000000000001',
          actor_email: 'casey@savingkc.com',
          status: 'complete',
          model: 'openai/gpt-5.6-luna',
          response_message_id: '40000000-0000-4000-8000-000000000001',
        },
        error: null,
      }),
    }
    const messageQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          metadata: {
            feature: 'next_action_proposal', leadId: LEAD_ID, promptVersion: 'next-action-proposal-v1',
            proposal: { rationale: 'Seller requested a family-review callback.', confidence: 'high' },
            evidence: [
              { id: 'activity:source-1', label: 'Call activity', url: `https://crm.savingkc.com/leads/${LEAD_ID}?section=activity`, summary: 'Seller requested a callback.' },
              { id: 'lead:source-2', label: 'Lead record', url: `https://crm.savingkc.com/leads/${LEAD_ID}`, summary: 'Casey owns this lead.' },
            ],
          },
        },
        error: null,
      }),
    }
    const db = {
      from: vi.fn((table: string) => table === 'assistant_generations' ? generationQuery : messageQuery),
    } as unknown as SupabaseClient

    await expect(verifyNextActionGeneration({
      generationId: '30000000-0000-4000-8000-000000000001',
      actorEmail: 'casey@savingkc.com',
      leadId: LEAD_ID,
    }, db)).resolves.toEqual({
      aiGenerationId: '30000000-0000-4000-8000-000000000001',
      aiEvidenceIds: ['activity:source-1', 'lead:source-2'],
      aiSources: [
        { name: 'Call activity', url: `https://crm.savingkc.com/leads/${LEAD_ID}?section=activity`, detail: 'Seller requested a callback.' },
        { name: 'Lead record', url: `https://crm.savingkc.com/leads/${LEAD_ID}`, detail: 'Casey owns this lead.' },
      ],
      aiModel: 'openai/gpt-5.6-luna',
      aiPromptVersion: 'next-action-proposal-v1',
      aiRationale: 'Seller requested a family-review callback.',
      aiConfidence: 'high',
    })
    expect(generationQuery.eq).toHaveBeenCalledWith('actor_email', 'casey@savingkc.com')
    expect(messageQuery.eq).toHaveBeenCalledWith('generation_id', '30000000-0000-4000-8000-000000000001')
  })

  it('rejects an AI generation whose persisted contact does not match', async () => {
    const generationQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: {
          id: '30000000-0000-4000-8000-000000000001',
          response_message_id: '40000000-0000-4000-8000-000000000001',
        },
        error: null,
      }),
    }
    const messageQuery = {
      select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({
        data: { metadata: { feature: 'next_action_proposal', leadId: '90000000-0000-4000-8000-000000000009' } },
        error: null,
      }),
    }
    const db = { from: vi.fn((table: string) => table === 'assistant_generations' ? generationQuery : messageQuery) } as unknown as SupabaseClient
    await expect(verifyNextActionGeneration({
      generationId: '30000000-0000-4000-8000-000000000001',
      actorEmail: 'casey@savingkc.com',
      leadId: LEAD_ID,
    }, db)).rejects.toThrow('does not match this contact')
  })

  it('copies only server-verified AI provenance into the eventual work item', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        created: true,
        workItem: {
          work_item_key: 'activity:20000000-0000-4000-8000-000000000001', source_kind: 'activity',
          source_id: '20000000-0000-4000-8000-000000000001', lead_id: LEAD_ID, tc_file_id: null,
          kind: 'callback', title: 'Call seller', description: null, status: 'pending', priority: 'normal',
          due_at: '2026-08-22T15:00:00.000Z', assigned_to: 'Casey', department: 'acquisitions', role: 'setter',
          primary_next_action: false, version: 1, source_created_at: NOW.toISOString(), completed_at: null, updated_at: NOW.toISOString(),
        },
      },
      error: null,
    })
    await executeApprovedFollowUpTask({
      runId: '50000000-0000-4000-8000-000000000001', workflowVersion: 1, definitionHash: 'b'.repeat(64),
      triggerKind: 'manual', requestedBy: 'Casey',
      payload: {
        leadId: LEAD_ID, title: 'Call seller', dueAt: '2026-08-22T15:00:00.000Z', assignedTo: 'Casey', kind: 'callback',
        aiGenerationId: '30000000-0000-4000-8000-000000000001', aiEvidenceIds: ['activity:source-1'],
        aiModel: 'openai/gpt-5.6-luna', aiPromptVersion: 'next-action-proposal-v1',
      },
    }, { rpc } as unknown as SupabaseClient)
    expect(rpc).toHaveBeenCalledWith('create_work_item_v2', expect.objectContaining({
      p_provenance: expect.objectContaining({
        ai_assisted: true,
        ai_generation_id: '30000000-0000-4000-8000-000000000001',
        ai_evidence_ids: ['activity:source-1'],
        ai_prompt_version: 'next-action-proposal-v1',
      }),
    }))
  })
})
