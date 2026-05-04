export type CallerIdMode = 'static' | 'rotation'

export interface DialerCallerPlan {
  mode: CallerIdMode
  staticCallerId: string
  rotationCallerIds: string[]
  rotateEveryCalls: number
  redialCallerId: string | null
}

export function parseCallerIdsCsv(value: string | null | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

export function normalizeDialerCallerPlan(
  plan: Partial<DialerCallerPlan> | null | undefined,
  fallbackCallerId = '',
): DialerCallerPlan {
  const staticCallerId = typeof plan?.staticCallerId === 'string' && plan.staticCallerId.trim()
    ? plan.staticCallerId.trim()
    : fallbackCallerId
  const rotationCallerIds = Array.isArray(plan?.rotationCallerIds)
    ? plan.rotationCallerIds
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
    : []
  const rotateEveryCalls = Number.isFinite(Number(plan?.rotateEveryCalls))
    ? Math.max(1, Math.floor(Number(plan?.rotateEveryCalls)))
    : 50

  const rawMode = plan?.mode === 'rotation' ? 'rotation' : 'static'
  const mode: CallerIdMode = rawMode === 'rotation' && rotationCallerIds.length > 0 ? 'rotation' : 'static'

  return {
    mode,
    staticCallerId,
    rotationCallerIds,
    rotateEveryCalls,
    redialCallerId: typeof plan?.redialCallerId === 'string' && plan.redialCallerId.trim()
      ? plan.redialCallerId.trim()
      : null,
  }
}
