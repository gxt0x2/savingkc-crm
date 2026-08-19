const OPERATING_AGENT_NAMES = new Map([
  ['ernest', 'Ernest'],
  ['casey', 'Casey'],
  ['gertha', 'Gertha'],
])

export interface TaskAssigneeResolution {
  authorized: boolean
  assignedTo?: string | null
}

/**
 * Keep task ownership server-controlled without preventing intentional team
 * delegation. Known operating agents are canonicalized, and an authenticated
 * user whose profile is not in the small operating roster may still assign a
 * task to themself.
 */
export function resolveTaskAssignee(
  requested: unknown,
  authenticatedName: string,
  options: { defaultToActor: boolean; allowUnassigned?: boolean },
): TaskAssigneeResolution {
  const actorName = authenticatedName.trim()

  if (requested === undefined) {
    return options.defaultToActor
      ? { authorized: true, assignedTo: actorName }
      : { authorized: true }
  }

  if (requested === null || (typeof requested === 'string' && !requested.trim())) {
    return options.allowUnassigned
      ? { authorized: true, assignedTo: null }
      : { authorized: false }
  }

  if (typeof requested !== 'string') return { authorized: false }

  const trimmed = requested.trim()
  if (trimmed.toLowerCase() === actorName.toLowerCase()) {
    return { authorized: true, assignedTo: actorName }
  }

  const operatingAgent = OPERATING_AGENT_NAMES.get(trimmed.toLowerCase())
  return operatingAgent
    ? { authorized: true, assignedTo: operatingAgent }
    : { authorized: false }
}
