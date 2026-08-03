import { describe, expect, it } from 'vitest'
import { buildWorkflowDraft } from './workflow-store'

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
})
