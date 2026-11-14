import {
  CALLER_ID_LOOKBACK_MS,
  CALLER_ID_REST_COMPLIANCE,
  chicagoDateKey,
  isCallerIdHealthSlot,
  scoreCallerIdPool,
  type CallerIdDial,
  type CallerIdHealthAction,
  type CallerIdHealthPlan,
  type CallerIdRecord,
} from './caller-id-health'

export type CallerIdDialLoad = {
  dials: CallerIdDial[]
  truncated: boolean
}

export type CallerIdHealthStore = {
  loadNumbers(): Promise<CallerIdRecord[]>
  loadActiveTarget(): Promise<number>
  loadDials(sinceIso: string): Promise<CallerIdDialLoad>
  apply(actions: CallerIdHealthAction[], chicagoDate: string): Promise<string[]>
}

export type CallerIdHealthSummary = CallerIdHealthPlan & {
  ok: true
  readOnly: true
  generatedAt: string
  truncated: boolean
}

export type CallerIdHealthRunResult = {
  ok: true
  applied: boolean
  skipped: 'outside_ct_morning' | 'no_inventory' | null
  compliance: string
  generatedAt: string
  activeSet: string[]
  proposedActiveSet: string[]
  actions: CallerIdHealthAction[]
  proposedActions: CallerIdHealthAction[]
  window: CallerIdHealthPlan['window']
  poolConnectRate: number | null
  truncated: boolean
}

export class CallerIdHealthError extends Error {
  constructor(readonly code: 'dial_window_truncated' | 'health_unavailable', message: string) {
    super(message)
  }
}

export async function summarizeCallerIdHealth(
  store: Pick<CallerIdHealthStore, 'loadNumbers' | 'loadDials' | 'loadActiveTarget'>,
  now: Date,
): Promise<CallerIdHealthSummary> {
  const loaded = await loadPlan(store, now)
  if (loaded.truncated) {
    return {
      ...emptyPlan(loaded.plan),
      ok: true,
      readOnly: true,
      generatedAt: now.toISOString(),
      truncated: true,
    }
  }
  return { ...loaded.plan, ok: true, readOnly: true, generatedAt: now.toISOString(), truncated: false }
}

export async function runCallerIdHealth(store: CallerIdHealthStore, now: Date): Promise<CallerIdHealthRunResult> {
  const loaded = await loadPlan(store, now)
  const base = {
    ok: true as const,
    compliance: CALLER_ID_REST_COMPLIANCE,
    generatedAt: now.toISOString(),
    proposedActiveSet: loaded.plan.proposedActiveSet,
    proposedActions: loaded.truncated ? [] : loaded.plan.actions,
    window: loaded.plan.window,
    poolConnectRate: loaded.truncated ? null : loaded.plan.poolConnectRate,
    truncated: loaded.truncated,
  }
  if (loaded.numbers.length === 0) {
    return { ...base, applied: false, skipped: 'no_inventory', activeSet: [], actions: [] }
  }
  if (loaded.truncated) {
    throw new CallerIdHealthError('dial_window_truncated', 'Caller ID dial history was truncated, so no number was rested.')
  }
  if (!isCallerIdHealthSlot(now)) {
    return { ...base, applied: false, skipped: 'outside_ct_morning', activeSet: loaded.plan.activeSet, actions: [] }
  }
  const activeSet = await store.apply(loaded.plan.actions, chicagoDateKey(now))
  return { ...base, applied: true, skipped: null, activeSet, actions: loaded.plan.actions }
}

async function loadPlan(
  store: Pick<CallerIdHealthStore, 'loadNumbers' | 'loadDials' | 'loadActiveTarget'>,
  now: Date,
): Promise<{ numbers: CallerIdRecord[]; plan: CallerIdHealthPlan; truncated: boolean }> {
  const [numbers, activeTarget] = await Promise.all([store.loadNumbers(), store.loadActiveTarget()])
  const since = new Date(now.getTime() - CALLER_ID_LOOKBACK_MS).toISOString()
  const loaded = await store.loadDials(since)
  const plan = scoreCallerIdPool({
    now,
    numbers,
    dials: loaded.truncated ? [] : loaded.dials,
    activeTarget,
  })
  return { numbers, plan, truncated: loaded.truncated }
}

function emptyPlan(plan: CallerIdHealthPlan): CallerIdHealthPlan {
  return {
    ...plan,
    window: { dialingDays: [] },
    poolConnectRate: null,
    scores: [],
    actions: [],
    proposedActiveSet: plan.activeSet,
    unattributedDials: 0,
  }
}
