import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc }),
}))

import {
  applyCrmLifecycleCommand,
  isCrmLifecycleStage,
  lifecycleFieldsForStage,
} from './crm-lifecycle'

describe('governed CRM lifecycle service', () => {
  beforeEach(() => vi.clearAllMocks())

  it('uses the frozen seller lifecycle vocabulary', () => {
    expect(isCrmLifecycleStage('appointment_set')).toBe(true)
    expect(isCrmLifecycleStage('marketing')).toBe(false)
    expect(lifecycleFieldsForStage('new')).toEqual({ classification: null, priority: 'warm' })
    expect(lifecycleFieldsForStage('qualified')).toEqual({ classification: 'opportunity', priority: 'hot' })
    expect(lifecycleFieldsForStage('dead')).toEqual({ classification: 'dead', priority: 'cold' })
  })

  it('passes only server-resolved actor identity into the idempotent RPC', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        eventId: 'event-1', leadId: 'lead-1', stage: 'qualified',
        classification: 'opportunity', priority: 'hot', owner: 'Casey',
        deadReason: null, replayed: false,
      },
      error: null,
    })

    await applyCrmLifecycleCommand({
      leadId: 'lead-1',
      commandId: '11111111-1111-4111-8111-111111111111',
      commandType: 'transition',
      stage: 'qualified',
      owner: null,
      deadReason: null,
      deadReasonNotes: null,
      reason: 'Four pillars confirmed',
      evidenceType: null,
      evidenceReference: null,
      actorEmail: 'casey@savingkc.com',
      actorName: 'Casey',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('crm_apply_lifecycle_command_v1', expect.objectContaining({
      target_command_id: '11111111-1111-4111-8111-111111111111',
      target_stage: 'qualified',
      target_classification: 'opportunity',
      target_priority: 'hot',
      target_actor_email: 'casey@savingkc.com',
      target_actor_name: 'Casey',
    }))
  })

  it('fails closed when the command boundary is unavailable', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function missing' } })
    await expect(applyCrmLifecycleCommand({
      leadId: 'lead-1',
      commandId: '11111111-1111-4111-8111-111111111111',
      commandType: 'assign',
      stage: null,
      owner: 'Ernest',
      deadReason: null,
      deadReasonNotes: null,
      reason: null,
      evidenceType: null,
      evidenceReference: null,
      actorEmail: 'casey@savingkc.com',
      actorName: 'Casey',
    })).rejects.toMatchObject({ code: 'unavailable' })
  })
})
