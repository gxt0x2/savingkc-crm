import { DIALER_CALLER_ID_NUMBERS, isDialerCallerIdNumber } from '@/lib/twilio-numbers'

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
  const defaultCallerId = DIALER_CALLER_ID_NUMBERS[0]?.value ?? ''
  const safeFallbackCallerId = isDialerCallerIdNumber(fallbackCallerId) ? fallbackCallerId : defaultCallerId
  const staticCandidate = typeof plan?.staticCallerId === 'string' ? plan.staticCallerId.trim() : ''
  const staticCallerId = isDialerCallerIdNumber(staticCandidate)
    ? staticCandidate
    : safeFallbackCallerId
  const rotationCallerIds = Array.isArray(plan?.rotationCallerIds)
    ? plan.rotationCallerIds
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim())
      .filter((item) => isDialerCallerIdNumber(item))
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
    redialCallerId: typeof plan?.redialCallerId === 'string' && isDialerCallerIdNumber(plan.redialCallerId.trim())
      ? plan.redialCallerId.trim()
      : null,
  }
}
