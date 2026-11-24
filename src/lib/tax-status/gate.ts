import type { LiveTaxBalance } from './balances'
import {
  isFreshDelinquentCheck,
  isTaxSourcedList,
  judgeLiveBalance,
  nextTaxTier,
  serviceCounty,
  type TaxCheckResult,
  type TaxTier,
} from './decision'
import { inNightlyScope, inWeeklyScope, type TaxStatusPhase } from './schedule'

export interface TaxGateContact {
  name: string
  phone: string
  mojoListName: string
}

export interface TaxGateCandidate {
  key: string
  parcelId: string | null
  county: string | null
  listType: string
  prospectTrack: 'tax' | 'mortgage_foreclosure' | null
  tier: TaxTier | null
  /** List tag such as an August "Tax 3+". Never a substitute for a live balance. */
  historicalTag: string | null
  createdAt: string
  scoredAt: string | null
  onDialerList: boolean
  rowStatus: string | null
  propertyId: string | null
  prospectId: string | null
  sourceListRowId: string | null
  foreclosureId: string | null
  contacts: TaxGateContact[]
}

export interface StoredTaxCheck {
  result: TaxCheckResult
  checkedAt: string
  source: string
  balance: number | null
  yearsOwed: number | null
}

export interface CountyLookup {
  (input: { county: string; parcelId: string }): Promise<
    | { ok: true; source: string; balance: LiveTaxBalance }
    | { ok: false; source: string; reason: 'source_down' }
  >
}

export interface PlannedTaxCheck {
  candidate: TaxGateCandidate
  county: string | null
  inServiceArea: boolean
  result: TaxCheckResult | 'skipped_out_of_area'
  source: string | null
  balance: number | null
  yearsOwed: number | null
  tierBefore: TaxTier | null
  tierAfter: TaxTier | null
  rankBoost: 0 | 1
  /** Null means leave the source-list status alone. */
  nextStatus: 'ready' | 'dropped' | null
  statusReason: string | null
  queueRemoval: boolean
  exportAllowed: boolean
}

export function selectTaxGateCandidates(
  candidates: readonly TaxGateCandidate[],
  phase: TaxStatusPhase,
  now: Date,
  chicagoDate: string,
): TaxGateCandidate[] {
  if (phase === 'idle') return []
  if (phase === 'nightly') {
    return candidates.filter((candidate) => inNightlyScope(candidate.createdAt, candidate.scoredAt, chicagoDate))
  }
  if (phase === 'weekly') {
    return candidates.filter((candidate) =>
      inNightlyScope(candidate.createdAt, candidate.scoredAt, chicagoDate)
      || inWeeklyScope({
        createdAt: candidate.createdAt,
        onDialerList: candidate.onDialerList,
        rowStatus: candidate.rowStatus,
        now,
      }),
    )
  }
  return candidates.filter((candidate) => {
    if (!isTaxSourcedList(candidate.listType, candidate.prospectTrack)) return false
    return candidate.rowStatus === 'ready'
      || candidate.rowStatus === 'loaded_to_dialer'
      || candidate.onDialerList
  })
}

function statusForTaxList(
  candidate: TaxGateCandidate,
  result: TaxCheckResult,
  allowAdd: boolean,
): { nextStatus: 'ready' | 'dropped' | null; statusReason: string | null; queueRemoval: boolean } {
  if (result === 'not_delinquent') {
    return {
      nextStatus: candidate.rowStatus === 'dropped' ? null : 'dropped',
      statusReason: 'tax_not_currently_delinquent',
      queueRemoval: candidate.onDialerList || candidate.rowStatus === 'loaded_to_dialer',
    }
  }
  if (result !== 'delinquent' || !allowAdd) {
    return { nextStatus: null, statusReason: null, queueRemoval: false }
  }
  if (candidate.rowStatus === 'new' || candidate.rowStatus === 'needs_check' || candidate.rowStatus === 'dropped') {
    return { nextStatus: 'ready', statusReason: 'tax_verified_delinquent', queueRemoval: false }
  }
  return { nextStatus: null, statusReason: null, queueRemoval: false }
}

export async function planTaxGateCandidate(
  candidate: TaxGateCandidate,
  options: {
    now: Date
    allowAdd: boolean
    callSources: boolean
    lookup: CountyLookup
    stored: StoredTaxCheck | null
  },
): Promise<PlannedTaxCheck> {
  const county = serviceCounty(candidate.county)
  const taxList = isTaxSourcedList(candidate.listType, candidate.prospectTrack)
  const base = {
    candidate,
    county,
    tierBefore: candidate.tier,
  }

  if (!county || !candidate.parcelId) {
    return {
      ...base,
      inServiceArea: false,
      result: 'skipped_out_of_area',
      source: null,
      balance: null,
      yearsOwed: null,
      tierAfter: candidate.tier,
      rankBoost: 0,
      nextStatus: null,
      statusReason: null,
      queueRemoval: false,
      exportAllowed: !taxList,
    }
  }

  let result: TaxCheckResult
  let source: string | null = options.stored?.source ?? null
  let balance = options.stored?.balance ?? null
  let yearsOwed = options.stored?.yearsOwed ?? null
  let storedForExport = options.stored

  if (options.callSources) {
    let looked: Awaited<ReturnType<CountyLookup>>
    try {
      looked = await options.lookup({ county, parcelId: candidate.parcelId })
    } catch {
      looked = { ok: false, source: `${county}_collector`, reason: 'source_down' }
    }
    source = looked.source
    if (looked.ok) {
      balance = looked.balance.balance
      yearsOwed = looked.balance.yearsOwed
      result = judgeLiveBalance({
        balance: looked.balance,
        sourceDown: false,
        historicalTag: candidate.historicalTag,
      })
    } else {
      balance = null
      yearsOwed = null
      result = judgeLiveBalance({ balance: null, sourceDown: true, historicalTag: candidate.historicalTag })
    }
    storedForExport = {
      result,
      checkedAt: options.now.toISOString(),
      source,
      balance,
      yearsOwed,
    }
  } else {
    result = options.stored?.result ?? 'not_verified'
  }

  const delinquent = result === 'delinquent'
  const tierAfter = taxList ? nextTaxTier(candidate.tier, yearsOwed ?? 0, delinquent) : candidate.tier
  const rankBoost: 0 | 1 = !taxList && delinquent ? 1 : 0
  const status = taxList
    ? statusForTaxList(candidate, result, options.allowAdd)
    : { nextStatus: null, statusReason: null, queueRemoval: false }

  return {
    ...base,
    inServiceArea: true,
    result,
    source,
    balance,
    yearsOwed,
    tierAfter,
    rankBoost,
    nextStatus: status.nextStatus,
    statusReason: status.statusReason,
    queueRemoval: status.queueRemoval,
    exportAllowed: taxList ? isFreshDelinquentCheck(storedForExport, options.now) : true,
  }
}
