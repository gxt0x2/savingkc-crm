export type AppointmentAgentChoice = {
  value: string
  label: string
}

const OPERATING_AGENTS: AppointmentAgentChoice[] = [
  { value: 'ernest', label: 'Ernest Dodson' },
  { value: 'casey', label: 'Casey Davis' },
]

function includesAgent(value: string, agent: 'ernest' | 'casey'): boolean {
  return value.toLowerCase().includes(agent)
}

/** Ernest and Casey stay on the roster. Any other signed-in user can assign the appointment to themself. */
export function appointmentAgentChoices(actorName: string | null | undefined): AppointmentAgentChoice[] {
  const actor = actorName?.trim() || ''
  if (!actor || includesAgent(actor, 'ernest') || includesAgent(actor, 'casey')) return OPERATING_AGENTS
  return [{ value: actor, label: actor }, ...OPERATING_AGENTS]
}

export function appointmentAgentValue(
  actorName: string | null | undefined,
  assignedTo?: string | null,
): string {
  const assigned = assignedTo?.trim() || ''
  if (assigned) {
    if (includesAgent(assigned, 'casey')) return 'casey'
    if (includesAgent(assigned, 'ernest')) return 'ernest'
    return assigned
  }
  const actor = actorName?.trim() || ''
  if (includesAgent(actor, 'casey')) return 'casey'
  if (includesAgent(actor, 'ernest')) return 'ernest'
  return actor || 'ernest'
}
