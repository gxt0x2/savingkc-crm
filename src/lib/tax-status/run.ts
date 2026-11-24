import { planTaxGateCandidate, selectTaxGateCandidates, type CountyLookup, type PlannedTaxCheck, type StoredTaxCheck, type TaxGateCandidate } from './gate'
import { taxStatusWindow, type TaxStatusWindow } from './schedule'

export const TAX_STATUS_BATCH_LIMIT = 80
const LOOKUP_CONCURRENCY = 4

export interface TaxStatusRun {
  window: TaxStatusWindow
  considered: number
  plans: PlannedTaxCheck[]
  truncated: boolean
}

async function mapPool<T, R>(items: readonly T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function run() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => run()))
  return results
}

export async function runTaxStatusPlans(input: {
  now: Date
  candidates: readonly TaxGateCandidate[]
  storedByKey: ReadonlyMap<string, StoredTaxCheck>
  lookup: CountyLookup
  limit?: number
}): Promise<TaxStatusRun> {
  const window = taxStatusWindow(input.now)
  const selected = selectTaxGateCandidates(input.candidates, window.phase, input.now, window.clock.date)
  const limit = input.limit ?? TAX_STATUS_BATCH_LIMIT
  const batch = selected.slice(0, limit)
  const plans = window.phase === 'idle'
    ? []
    : await mapPool(batch, LOOKUP_CONCURRENCY, (candidate) => planTaxGateCandidate(candidate, {
      now: input.now,
      allowAdd: window.allowAdd,
      callSources: window.callSources,
      lookup: input.lookup,
      stored: input.storedByKey.get(candidate.key) ?? null,
    }))
  return {
    window,
    considered: selected.length,
    plans,
    truncated: selected.length > batch.length,
  }
}

export function summarizeTaxStatusRun(run: TaxStatusRun) {
  const count = (result: PlannedTaxCheck['result']) => run.plans.filter((plan) => plan.result === result).length
  return {
    phase: run.window.phase,
    allowAdd: run.window.allowAdd,
    callSources: run.window.callSources,
    chicago: run.window.clock,
    considered: run.considered,
    checked: run.plans.length,
    truncated: run.truncated,
    delinquent: count('delinquent'),
    notDelinquent: count('not_delinquent'),
    notVerified: count('not_verified'),
    skippedOutOfArea: count('skipped_out_of_area'),
    suppressed: run.plans.filter((plan) => plan.nextStatus === 'dropped').length,
    promoted: run.plans.filter((plan) => plan.nextStatus === 'ready').length,
    removalQueued: run.plans.filter((plan) => plan.queueRemoval).length,
    mojoWriteApi: null as null,
  }
}
