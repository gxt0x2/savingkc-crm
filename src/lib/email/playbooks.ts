import { REQUIRED_ESCALATIONS } from './ai/constants'

export function canEditPlaybookVersion(state: 'draft' | 'published') {
  return state === 'draft'
}

export function requiredEscalations() {
  return REQUIRED_ESCALATIONS
}

export function playbookKeepsRequiredEscalations(listed: string[]) {
  return REQUIRED_ESCALATIONS.every((rule) => listed.includes(rule))
}

export function publishingRaisesAutonomy(input: {
  previousActions: string[]
  nextActions: string[]
}) {
  return input.nextActions.some(
    (action) => !input.previousActions.includes(action),
  )
}
