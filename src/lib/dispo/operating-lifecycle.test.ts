import { describe, expect, it } from 'vitest'
import type { TcTask } from '@/types/dispo'
import {
  DISPOSITION_OPERATING_LIFECYCLE,
  activeDispositionPhases,
  calculateDispositionTaskDueAt,
  dispositionTaskDefinition,
  summarizeDispositionPhase,
  validateDispositionStageGate,
} from './operating-lifecycle'

function recordedTask(taskType: string, status: TcTask['status'] = 'done'): TcTask {
  return {
    id: `task-${taskType}`,
    tc_file_id: 'file-1',
    task_type: taskType,
    label: taskType,
    status,
    due_at: null,
    completed_at: status === 'done' ? '2026-08-05T12:00:00.000Z' : null,
    assigned_to: null,
    source: 'test',
    notes: null,
  }
}

describe('disposition operating lifecycle', () => {
  it('keeps every operating task type unique', () => {
    const taskTypes = DISPOSITION_OPERATING_LIFECYCLE.flatMap((phase) => phase.tasks.map((task) => task.taskType))
    expect(new Set(taskTypes).size).toBe(taskTypes.length)
  })

  it('activates intake immediately and later phases as the real transaction advances', () => {
    expect(activeDispositionPhases({ dealStage: 'new', tcStatus: 'not_opened' }).map((phase) => phase.id)).toEqual([
      'contract_intake',
      'deal_readiness',
    ])
    expect(activeDispositionPhases({ dealStage: 'offers_in', tcStatus: 'opened' }).map((phase) => phase.id)).toEqual([
      'contract_intake',
      'deal_readiness',
      'buyer_marketing',
      'assignment',
      'closing_readiness',
    ])
    expect(activeDispositionPhases({ dealStage: 'closed', tcStatus: 'closed' }).map((phase) => phase.id)).toHaveLength(7)
  })

  it('anchors closing work to the scheduled closing date', () => {
    const task = dispositionTaskDefinition('ops.docs.approve_closing')
    expect(task).not.toBeNull()
    expect(calculateDispositionTaskDueAt(task!.definition, {
      dealStage: 'under_contract',
      tcStatus: 'scheduled',
      enteredAt: '2026-08-01T12:00:00.000Z',
      closingAt: '2026-08-20T17:00:00.000Z',
    })).toBe('2026-08-19T17:00:00.000Z')
  })

  it('does not clear a phase gate until every required task is recorded complete', () => {
    const phase = DISPOSITION_OPERATING_LIFECYCLE.find((candidate) => candidate.id === 'contract_intake')!
    const required = phase.tasks.filter((task) => task.gate).map((task) => recordedTask(task.taskType))
    expect(summarizeDispositionPhase(phase, required.slice(1)).gateComplete).toBe(false)
    expect(summarizeDispositionPhase(phase, required).gateComplete).toBe(true)
  })

  it('blocks forward stage movement until workflow gates and buyer acceptance are explicit', () => {
    const prerequisitePhases = DISPOSITION_OPERATING_LIFECYCLE.filter((phase) => ['contract_intake', 'deal_readiness', 'buyer_marketing', 'assignment'].includes(phase.id))
    const completedTasks = prerequisitePhases.flatMap((phase) => phase.tasks.filter((task) => task.gate).map((task) => recordedTask(task.taskType)))

    expect(validateDispositionStageGate('offers_in', 'under_contract', completedTasks)).toMatchObject({
      allowed: false,
      missing: ['Record the accepted offer', 'Record the accepted buyer'],
    })
    expect(validateDispositionStageGate('offers_in', 'under_contract', completedTasks, {
      acceptedOfferId: 'offer-1',
      acceptedBuyerId: 'buyer-1',
    }).allowed).toBe(true)
  })

  it('includes the critical ClickUp controls across both team lanes and closeout', () => {
    expect(dispositionTaskDefinition('ops.valuation.project_arv')?.definition.lane).toBe('dispositions')
    expect(dispositionTaskDefinition('ops.emd.buyer_receipt')?.definition.lane).toBe('coordination')
    expect(dispositionTaskDefinition('ops.closing.verify_payments')?.definition.gate).toBe(true)
    expect(dispositionTaskDefinition('ops.closeout.debrief')?.definition.lane).toBe('shared')
  })
})
