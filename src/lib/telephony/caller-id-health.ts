import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { classifyMojoDialResult } from '@/lib/server/mojo-dial-outcome'

export const CALLER_ID_REST_DAYS = 14
export const CALLER_ID_MIN_DIALS = 20
export const CALLER_ID_CONNECT_GAP = 0.15
export const CALLER_ID_DAILY_CAP = 75
export const CALLER_ID_ACTIVE_TARGET = 3
export const CALLER_ID_DIALING_DAY_LIMIT = 3
export const CALLER_ID_LOOKBACK_MS = 21 * 24 * 60 * 60 * 1000
export const CALLER_ID_DEDUPE_MS = 60_000
export const CALLER_ID_SLOT_START_MINUTES = 7 * 60 + 50
export const CALLER_ID_SLOT_END_MINUTES = 8 * 60 + 30

export const CALLER_ID_REST_COMPLIANCE =
  'Resting is a quality pause. It is not a rotation to evade spam labels. A rested number returns only after its cause is checked (spam label, Voice Integrity, and CNAM), or when rest_until has passed and a manual or health check clears it. This job never releases or deletes a number.'

export const CALLER_ID_STATUSES = ['active', 'spare', 'resting', 'held'] as const
export type CallerIdStatus = (typeof CALLER_ID_STATUSES)[number]

export type CallerIdRecord = {
  number: string
  areaCode: string
  status: CallerIdStatus
  restUntil: string | null
  restReason: string | null
}

export type CallerIdDialSource = 'mojo' | 'twilio'

export type CallerIdDial = {
  callerId: string
  at: string
  connected: boolean
  source: CallerIdDialSource
}

export type CallerIdMetrics = {
  dialingDays: string[]
  dials: number
  connects: number
  connectRate: number | null
  poolConnectRate: number | null
  gapPoints: number | null
  maxDialsOnADay: number
  busiestDay: string | null
  belowPool: boolean
  overCap: boolean
  compliance: 'quality_pause'
}

export type CallerIdHealthAction =
  | { type: 'rest'; number: string; restUntil: string; reason: string; metrics: CallerIdMetrics }
  | { type: 'cap_note'; number: string; reason: string; metrics: CallerIdMetrics }
  | { type: 'promote'; number: string; areaCode: string; replaces: string | null; reason: string }
  | { type: 'rest_elapsed_needs_clearance'; number: string; restUntil: string; reason: string }
  | { type: 'rest_confirmed'; number: string; reason: string; metrics: CallerIdMetrics }

export type CallerIdHealthPlan = {
  compliance: string
  window: { dialingDays: string[] }
  poolConnectRate: number | null
  scores: Array<CallerIdMetrics & { number: string; status: CallerIdStatus; areaCode: string }>
  held: Array<{ number: string; areaCode: string; status: 'held' }>
  actions: CallerIdHealthAction[]
  activeSet: string[]
  proposedActiveSet: string[]
  unattributedDials: number
}

const NOT_CONNECTED = new Set(['no_answer', 'busy', 'disconnected'])

export function mojoDialConnected(label: string | null, code: number | null, durationSeconds: number): boolean {
  const classified = classifyMojoDialResult(label, code)
  if (NOT_CONNECTED.has(classified.outcome)) return false
  if (classified.outcome === 'other') return durationSeconds > 0
  return true
}

export function twilioDialConnected(status: string, durationSeconds: number): boolean {
  const normalized = status.trim().toLowerCase()
  if (normalized === 'completed') return durationSeconds > 0
  if (normalized === 'answered' || normalized === 'in-progress') return true
  return false
}

export function chicagoDateKey(instant: Date): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export function isCallerIdHealthSlot(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  const weekday = value('weekday')
  if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday)) return false
  const minutes = Number(value('hour')) * 60 + Number(value('minute'))
  return minutes >= CALLER_ID_SLOT_START_MINUTES && minutes <= CALLER_ID_SLOT_END_MINUTES
}

export function callerIdRestUntil(now: Date): string {
  return new Date(now.getTime() + CALLER_ID_REST_DAYS * 24 * 60 * 60 * 1000).toISOString()
}

export function chicagoDayBounds(date: string): { start: string; end: string } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('invalid_caller_id_health_day')
  const [year, month, day] = date.split('-').map(Number)
  const next = new Date(Date.UTC(year, month - 1, day))
  next.setUTCDate(next.getUTCDate() + 1)
  const nextDate = next.toISOString().slice(0, 10)
  return {
    start: new Date(`${date}T00:00:00${chicagoOffset(date)}`).toISOString(),
    end: new Date(`${nextDate}T00:00:00${chicagoOffset(nextDate)}`).toISOString(),
  }
}

function chicagoOffset(date: string): string {
  const name = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    timeZoneName: 'shortOffset',
  }).formatToParts(new Date(`${date}T12:00:00Z`)).find((part) => part.type === 'timeZoneName')?.value ?? 'GMT-6'
  const hours = Number(name.replace('GMT', '') || '0')
  return `${hours < 0 ? '-' : '+'}${String(Math.abs(hours)).padStart(2, '0')}:00`
}

export function dedupeCallerIdDials(dials: CallerIdDial[]): CallerIdDial[] {
  const sorted = [...dials].sort((left, right) => {
    const byTime = left.at.localeCompare(right.at)
    if (byTime !== 0) return byTime
    if (left.source === right.source) return left.callerId.localeCompare(right.callerId)
    return left.source === 'mojo' ? -1 : 1
  })
  const kept: CallerIdDial[] = []
  for (const dial of sorted) {
    const at = Date.parse(dial.at)
    if (!Number.isFinite(at)) continue
    const clashIndex = kept.findIndex((existing) => (
      existing.callerId === dial.callerId
      && existing.source !== dial.source
      && Math.abs(Date.parse(existing.at) - at) <= CALLER_ID_DEDUPE_MS
    ))
    if (clashIndex === -1) {
      kept.push(dial)
      continue
    }
    if (kept[clashIndex]?.source !== 'mojo' && dial.source === 'mojo') kept[clashIndex] = dial
  }
  return kept
}

function areaCodeOf(phone: string): string | null {
  const normalized = normalizePhoneToE164(phone)
  if (!normalized) return null
  return normalized.slice(2, 5)
}

function percent(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`
}

function oneDecimal(value: number): number {
  return Math.round(value * 10) / 10
}

function metricsFor(input: {
  days: string[]
  dials: CallerIdDial[]
  poolConnectRate: number | null
}): CallerIdMetrics {
  const connects = input.dials.filter((dial) => dial.connected).length
  const dials = input.dials.length
  const connectRate = dials > 0 ? connects / dials : null
  const byDay = new Map<string, number>()
  for (const dial of input.dials) {
    const day = chicagoDateKey(new Date(dial.at))
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
  }
  let maxDialsOnADay = 0
  let busiestDay: string | null = null
  for (const [day, count] of byDay) {
    if (count > maxDialsOnADay) {
      maxDialsOnADay = count
      busiestDay = day
    }
  }
  const gap = connectRate != null && input.poolConnectRate != null ? input.poolConnectRate - connectRate : null
  return {
    dialingDays: input.days,
    dials,
    connects,
    connectRate,
    poolConnectRate: input.poolConnectRate,
    gapPoints: gap == null ? null : oneDecimal(gap * 100),
    maxDialsOnADay,
    busiestDay,
    belowPool: dials >= CALLER_ID_MIN_DIALS && gap != null && gap >= CALLER_ID_CONNECT_GAP,
    overCap: maxDialsOnADay > CALLER_ID_DAILY_CAP,
    compliance: 'quality_pause',
  }
}

function dialingDays(dials: CallerIdDial[], today: string): string[] {
  const days = new Set<string>()
  for (const dial of dials) {
    const at = Date.parse(dial.at)
    if (!Number.isFinite(at)) continue
    const day = chicagoDateKey(new Date(at))
    if (day < today) days.add(day)
  }
  return [...days].sort().slice(-CALLER_ID_DIALING_DAY_LIMIT)
}

function restReason(number: string, metrics: CallerIdMetrics): string {
  const rate = metrics.connectRate ?? 0
  const pool = metrics.poolConnectRate ?? 0
  return `Quality pause for ${number}: connect rate ${percent(rate)} is ${metrics.gapPoints?.toFixed(1) ?? '0.0'} points below the pool average ${percent(pool)} across ${metrics.dialingDays.length} dialing day(s) and ${metrics.dials} dials. Not a rotation to evade spam labels.`
}

function capReason(metrics: CallerIdMetrics): string {
  return `Cap note only: ${metrics.maxDialsOnADay} dials on ${metrics.busiestDay ?? 'a dialing day'} exceeds ${CALLER_ID_DAILY_CAP} dials in a day. Status was not changed.`
}

export function scoreCallerIdPool(input: {
  now: Date
  numbers: CallerIdRecord[]
  dials: CallerIdDial[]
}): CallerIdHealthPlan {
  const today = chicagoDateKey(input.now)
  const pool: CallerIdRecord[] = []
  const held: CallerIdHealthPlan['held'] = []
  const seen = new Set<string>()
  for (const number of input.numbers) {
    const normalized = normalizePhoneToE164(number.number)
    const areaCode = normalized ? areaCodeOf(normalized) : null
    if (!normalized || !areaCode || number.areaCode !== areaCode || seen.has(normalized)) continue
    if (!CALLER_ID_STATUSES.includes(number.status)) continue
    seen.add(normalized)
    const row = { ...number, number: normalized, areaCode }
    if (row.status === 'held') held.push({ number: normalized, areaCode, status: 'held' })
    else pool.push(row)
  }

  const deduped = dedupeCallerIdDials(input.dials)
  const poolIds = new Set(pool.map((number) => number.number))
  const inventoryIds = new Set([...poolIds, ...held.map((number) => number.number)])
  let unattributedDials = 0
  const attributed: CallerIdDial[] = []
  for (const dial of deduped) {
    const callerId = normalizePhoneToE164(dial.callerId)
    if (!callerId || !inventoryIds.has(callerId)) {
      unattributedDials += 1
      continue
    }
    if (!poolIds.has(callerId)) continue
    attributed.push({ ...dial, callerId })
  }

  const days = dialingDays(attributed, today)
  const daySet = new Set(days)
  const inWindow = attributed.filter((dial) => daySet.has(chicagoDateKey(new Date(dial.at))))
  const byNumber = new Map<string, CallerIdDial[]>()
  for (const dial of inWindow) {
    const rows = byNumber.get(dial.callerId) ?? []
    rows.push(dial)
    byNumber.set(dial.callerId, rows)
  }

  const scores = pool.map((number) => {
    const rows = byNumber.get(number.number) ?? []
    const others = inWindow.filter((dial) => dial.callerId !== number.number)
    const poolConnectRate = others.length > 0
      ? others.filter((dial) => dial.connected).length / others.length
      : null
    return { number: number.number, status: number.status, areaCode: number.areaCode, ...metricsFor({ days, dials: rows, poolConnectRate }) }
  })
  const scoreByNumber = new Map(scores.map((score) => [score.number, score]))

  const actions: CallerIdHealthAction[] = []
  const restingToday = new Set<string>()
  for (const number of pool) {
    const metrics = scoreByNumber.get(number.number)
    if (!metrics) continue
    if (metrics.overCap) actions.push({ type: 'cap_note', number: number.number, reason: capReason(metrics), metrics })
    if (!metrics.belowPool) continue
    if (number.status === 'active') {
      actions.push({
        type: 'rest',
        number: number.number,
        restUntil: callerIdRestUntil(input.now),
        reason: restReason(number.number, metrics),
        metrics,
      })
      restingToday.add(number.number)
    } else if (number.status === 'resting') {
      actions.push({
        type: 'rest_confirmed',
        number: number.number,
        reason: `Still below the pool while resting. rest_until was not extended. ${restReason(number.number, metrics)}`,
        metrics,
      })
    }
  }

  for (const number of pool) {
    if (number.status !== 'resting' || !number.restUntil) continue
    const until = Date.parse(number.restUntil)
    if (!Number.isFinite(until) || until > input.now.getTime()) continue
    actions.push({
      type: 'rest_elapsed_needs_clearance',
      number: number.number,
      restUntil: number.restUntil,
      reason: `rest_until ${number.restUntil} has passed. Spam label, Voice Integrity, and CNAM still need a manual or health check before this number can return. It was not released.`,
    })
  }

  const promotions = promoteSpares(pool, restingToday, scoreByNumber)
  actions.push(...promotions)

  const activeSet = pool.filter((number) => number.status === 'active').map((number) => number.number).sort()
  const promoted = new Set(promotions.map((action) => action.number))
  const proposedActiveSet = pool
    .filter((number) => (number.status === 'active' && !restingToday.has(number.number)) || promoted.has(number.number))
    .map((number) => number.number)
    .sort()

  return {
    compliance: CALLER_ID_REST_COMPLIANCE,
    window: { dialingDays: days },
    poolConnectRate: inWindow.length > 0 ? inWindow.filter((dial) => dial.connected).length / inWindow.length : null,
    scores,
    held,
    actions,
    activeSet,
    proposedActiveSet,
    unattributedDials,
  }
}

function promoteSpares(
  pool: CallerIdRecord[],
  restingToday: Set<string>,
  scores: Map<string, CallerIdMetrics & { number: string }>,
): Array<Extract<CallerIdHealthAction, { type: 'promote' }>> {
  const remainingActive = pool.filter((number) => number.status === 'active' && !restingToday.has(number.number))
  let needed = Math.max(0, CALLER_ID_ACTIVE_TARGET - remainingActive.length)
  const areaOrder = [
    ...pool.filter((number) => restingToday.has(number.number)).map((number) => number.areaCode),
    ...remainingActive.map((number) => number.areaCode),
  ]
  const used = new Set<string>()
  const replaced = new Set<string>()
  const promotions: Array<Extract<CallerIdHealthAction, { type: 'promote' }>> = []
  while (needed > 0) {
    const spare = nextCleanSpare(pool, areaOrder, used, scores)
    if (!spare) break
    used.add(spare.number)
    const replaces = pool.find((number) => (
      restingToday.has(number.number)
      && number.areaCode === spare.areaCode
      && !replaced.has(number.number)
    ))?.number ?? null
    if (replaces) replaced.add(replaces)
    promotions.push({
      type: 'promote',
      number: spare.number,
      areaCode: spare.areaCode,
      replaces,
      reason: `Promoted spare ${spare.number} to active so the ${spare.areaCode} pool keeps ${CALLER_ID_ACTIVE_TARGET} active numbers after a quality pause. Mojo is not changed by this job.`,
    })
    needed -= 1
  }
  return promotions
}

function nextCleanSpare(
  pool: CallerIdRecord[],
  areaOrder: string[],
  used: Set<string>,
  scores: Map<string, CallerIdMetrics>,
): CallerIdRecord | null {
  const areas: string[] = []
  for (const area of areaOrder) if (!areas.includes(area)) areas.push(area)
  for (const area of areas) {
    const spare = pool
      .filter((number) => number.status === 'spare' && number.areaCode === area && !used.has(number.number))
      .filter((number) => scores.get(number.number)?.belowPool !== true)
      .sort((left, right) => left.number.localeCompare(right.number))[0]
    if (spare) return spare
  }
  return null
}
