import { describe, expect, it } from 'vitest'
import {
  canEditPlaybookVersion,
  playbookKeepsRequiredEscalations,
  publishingRaisesAutonomy,
  requiredEscalations,
} from '../playbooks'

describe('playbook versions', () => {
  it('keeps published policy immutable', () => {
    expect(canEditPlaybookVersion('draft')).toBe(true)
    expect(canEditPlaybookVersion('published')).toBe(false)
  })
  it('cannot drop a required escalation through the editor', () => {
    expect(playbookKeepsRequiredEscalations(requiredEscalations() as unknown as string[])).toBe(
      true,
    )
    expect(playbookKeepsRequiredEscalations(['pricing'])).toBe(false)
  })
  it('treats adding an automatic action as a raise in autonomy', () => {
    expect(
      publishingRaisesAutonomy({
        previousActions: [],
        nextActions: ['acknowledge_interest'],
      }),
    ).toBe(true)
  })
})
