import { describe, expect, it } from 'vitest'
import { buildWorkflowDraft, validateStoredWorkflowDraft } from './workflow-store'

describe('workflow draft governance', () => {
  it('creates a versioned, confirmation-backed definition', () => {
    const draft = buildWorkflowDraft({
      name: 'Appointment no-show recovery',
      description: 'Creates human review work when a seller misses an appointment.',
      category: 'appointment',
      owner: 'Acquisitions',
      trigger: 'Appointment marked no-show',
      actions: ['Create a callback task', 'Notify the assigned agent'],
      mutatesData: true,
      approvalPolicy: 'user_confirmation',
      rollbackPlan: 'Pause the draft and cancel tasks it created.',
    }, 'ernest@savingkc.com', new Date('2026-08-03T12:00:00.000Z'))

    expect(draft.definition).toMatchObject({
      status: 'draft',
      health: 'not_run',
      version: 1,
      implementation: { execution: 'configuration', approvalPolicy: 'user_confirmation' },
    })
    expect(draft.definition.actions).toHaveLength(2)
    expect(draft.governance.rollbackPlan).toContain('Pause')
  })

  it('rejects incomplete definitions', () => {
    expect(() => buildWorkflowDraft({
      name: 'Incomplete',
      description: '',
      category: 'ai',
      owner: 'ARI',
      trigger: '',
      actions: [],
      mutatesData: false,
      approvalPolicy: 'admin_only',
      rollbackPlan: '',
    }, 'ernest@savingkc.com')).toThrow(/required/)
  })

  it('validates a draft without pretending descriptive actions are executable', () => {
    const draft = buildWorkflowDraft({
      name: 'Appointment no-show recovery',
      description: 'Creates human review work when a seller misses an appointment.',
      category: 'appointment',
      owner: 'Acquisitions',
      trigger: 'Appointment marked no-show',
      actions: ['Create a callback task', 'Notify the assigned agent'],
      mutatesData: true,
      approvalPolicy: 'user_confirmation',
      rollbackPlan: 'Pause the workflow and review created work before reversal.',
    }, 'Ernest', new Date('2026-08-24T12:00:00.000Z'))

    const report = validateStoredWorkflowDraft(draft, new Date('2026-08-24T13:00:00.000Z'))

    expect(report).toMatchObject({
      mode: 'validation_only',
      readyForReview: true,
      readyForPublish: false,
      generatedAt: '2026-08-24T13:00:00.000Z',
      boundary: { mutatesData: true, approvalPolicy: 'user_confirmation', execution: 'configuration' },
    })
    expect(report.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'definition_contract', status: 'pass' }),
      expect.objectContaining({ id: 'executor_mapping', status: 'blocked' }),
    ]))
    expect(report.plannedEffects).toEqual([
      expect.objectContaining({ order: 1, executor: 'not_wired', effect: 'potential_crm_write' }),
      expect.objectContaining({ order: 2, executor: 'not_wired', effect: 'potential_crm_write' }),
    ])
  })

  it('blocks review when draft governance is incomplete', () => {
    const draft = buildWorkflowDraft({
      name: 'Read-only inspection',
      description: 'Reviews a bounded operating metric.',
      category: 'reporting',
      owner: 'Operations',
      trigger: 'Operator requests the report',
      actions: ['Read the bounded report'],
      mutatesData: false,
      approvalPolicy: 'admin_only',
      rollbackPlan: 'Remove the draft.',
    }, 'Ernest')
    draft.governance.rollbackPlan = ''

    const report = validateStoredWorkflowDraft(draft)

    expect(report.readyForReview).toBe(false)
    expect(report.readyForPublish).toBe(false)
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'rollback_plan', status: 'blocked' }))
    expect(report.plannedEffects[0]).toMatchObject({ effect: 'read_only', executor: 'not_wired' })
  })
})
