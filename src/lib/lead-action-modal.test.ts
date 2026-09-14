import { describe, expect, it } from 'vitest'
import { leadActionModalReducer } from './lead-action-modal'

describe('leadActionModalReducer', () => {
  it('replaces the appointment dialog when the task dialog opens', () => {
    expect(leadActionModalReducer('appointment', { type: 'open', modal: 'task' })).toBe('task')
  })

  it('replaces the task dialog when the appointment dialog opens', () => {
    expect(leadActionModalReducer('task', { type: 'open', modal: 'appointment' })).toBe('appointment')
  })

  it('closes the active dialog', () => {
    expect(leadActionModalReducer('appointment', { type: 'close' })).toBeNull()
  })
})
