import { coreMarketAddress, normalizeMarketAddress, normalizeParcelId, ownerNameVerdict, zip5 } from '@/lib/market-check/address'
import { expiredRowBlock, type ExpiredContactChannel } from '@/lib/market-check/expired-gate'
import type { MatrixRow } from '@/lib/market-check/matrix-csv'
import type { TargetZipStatus } from '@/lib/market-check/seeds'

export const SOLD_SINCE = '2026-01-01'
export const DEFAULT_EXPIRED_WINDOW_DAYS = 90

export type ListingStatus =
  | 'listed_active'
  | 'listed_pending'
  | 'sold_new_owner'
  | 'listed_withdrawn'
  | 'off_market_ok'
  | 'listing_check_unknown'
  | 'listing_expired'

export interface PoolRowInput {
  id: string
  listType: string
  parcelId: string | null
  address: string | null
  zip5: string | null
  state: string | null
  prospectOwner: string | null
  rollOwner: string | null
}

export interface MarketCheckDraft {
  parcelId: string | null
  addrNorm: string
  zip5: string
  source: 'heartland_matrix'
  listDay: string
  exportFileSha256: string
  mlsNumber: string | null
  listStatusRaw: string | null
  listingStatus: ListingStatus
  closeDate: string | null
  listPrice: number | null
  ownerOnRoll: string | null
  ownerChanged: boolean
  ownerCheckUnknown: boolean
  propertyKey: string
}

export interface TagDraft {
  poolRowId: string
  mlsTag: 'expired_listing' | 'active_high_price'
  strategy: 'wholesale' | 'novation_traditional'
  listDay: string
  propertyKey: string
}

export interface IntakeDraft {
  matchKey: string
  parcelId: string | null
  address: string
  addrNorm: string
  zip5: string
  mlsNumber: string | null
  listDay: string
  county: 'jackson'
  state: 'MO'
  propertyKey: string
}

export interface MarketPlan {
  checks: MarketCheckDraft[]
  tags: TagDraft[]
  intakes: IntakeDraft[]
  coveredZips: string[]
}

export interface PlanMarketCheckInput {
  rows: MatrixRow[]
  poolRows: PoolRowInput[]
  targetStatusByZip: ReadonlyMap<string, TargetZipStatus>
  minListPriceByZip: ReadonlyMap<string, number>
  today: string
  additionListDay: string
  allowOffMarket: boolean
  completeFile?: boolean
  hasExpireColumn?: boolean
  expiredWindowDays?: number
  fileSha256: string
}

/** Table-driven. Real Heartland codes for Expired, Withdrawn, and TOM can be added here. */
export const MATRIX_STATUS_TABLE: ReadonlyArray<{ keys: readonly string[]; status: ListingStatus }> = [
  { keys: ['ACT', 'ACTIVE', 'COMING SOON', 'CSN'], status: 'listed_active' },
  {
    keys: ['PND', 'PENDING', 'CONT', 'CONTINGENT', 'BACKUP', 'SHOW FOR BACKUPS', 'AUC', 'UNDER CONTRACT', 'UC', 'U C', 'ACTIVE UNDER CONTRACT'],
    status: 'listed_pending',
  },
  { keys: ['SLD', 'SOLD', 'CLOSED'], status: 'sold_new_owner' },
  { keys: ['WTH', 'WITHDRAWN', 'TOM', 'TEMP OFF MARKET', 'CAN', 'CANCELLED', 'CANCELED'], status: 'listed_withdrawn' },
  { keys: ['EXP', 'EXPIRED'], status: 'listing_expired' },
]

const RANK: Record<ListingStatus, number> = {
  listed_active: 6,
  listed_pending: 5,
  sold_new_owner: 4,
  listed_withdrawn: 3,
  listing_expired: 2,
  listing_check_unknown: 1,
  off_market_ok: 0,
}

export function matrixStatusKey(raw: string): string {
  return raw.trim().toUpperCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim()
}

export function matrixStatusRank(status: ListingStatus): number {
  return RANK[status]
}

interface Hit {
  status: ListingStatus
  mlsNumber: string | null
  raw: string
  closeDate: string | null
  listPrice: number | null
  zip5: string
  parcelId: string | null
  addrNorm: string
  address: string
}

function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  utc.setUTCDate(utc.getUTCDate() + days)
  return utc.toISOString().slice(0, 10)
}

export function classifyMatrixStatus(
  raw: string,
  dates: { closeDate: string | null; expireDate: string | null },
  today: string,
  expiredWindowDays: number,
): ListingStatus | 'unmapped' | null {
  const status = matrixStatusKey(raw)
  if (!status) return null
  const mapped = status.startsWith('UNDER CONTRACT')
    ? 'listed_pending'
    : MATRIX_STATUS_TABLE.find((row) => row.keys.includes(status))?.status
  if (!mapped) return 'unmapped'
  if (mapped === 'sold_new_owner') {
    if (!dates.closeDate || dates.closeDate < SOLD_SINCE) return null
    return 'sold_new_owner'
  }
  if (mapped === 'listing_expired') {
    const earliest = addDays(today, -expiredWindowDays)
    if (!dates.expireDate) return 'listing_check_unknown'
    if (dates.expireDate < earliest || dates.expireDate > today) return null
    return 'listing_expired'
  }
  return mapped
}

export function crmLeadListingStatus(
  deadReason: string | null | undefined,
  callResult: string | null | undefined,
): 'listed_active' | 'sold_new_owner' | null {
  const dead = (deadReason ?? '').trim().toLowerCase()
  const call = (callResult ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (dead === 'listed' || dead === 'listed_agent' || call === 'listed' || call === 'listed_agent') {
    return 'listed_active'
  }
  if (
    dead === 'already_sold' || dead === 'sold' || dead === 'sold_or_competitor'
    || call === 'already_sold' || call === 'sold' || call === 'sold_or_competitor'
  ) {
    return 'sold_new_owner'
  }
  return null
}

export function intakeAllowed(status: TargetZipStatus | undefined): boolean {
  return status === 'core' || status === 'keep'
}

export function propertyKey(parcelId: string | null, addrNorm: string, code: string): string {
  if (parcelId) return `parcel:${parcelId}`
  if (addrNorm && code) return `addr:${addrNorm}|${code}`
  return ''
}

export function poolMatchKey(parcelId: string | null, addrNorm: string, code: string): string {
  if (parcelId) return `parcel:${parcelId.slice(0, 80)}`
  const body = `${addrNorm}${code}`.replace(/[^A-Z0-9]/g, '').slice(0, 80)
  return `addr:${body}`
}

function prefer(current: Hit | undefined, next: Hit | undefined): Hit | undefined {
  if (!next) return current
  if (!current || RANK[next.status] > RANK[current.status]) return next
  return current
}

function hitFrom(row: MatrixRow, status: ListingStatus): Hit {
  return {
    status,
    mlsNumber: row.mlsNumber || null,
    raw: row.statusRaw,
    closeDate: row.closeDate,
    listPrice: row.listPrice,
    zip5: row.zip5,
    parcelId: row.parcelId,
    addrNorm: row.addrNorm,
    address: row.address,
  }
}

export function planMarketCheck(input: PlanMarketCheckInput): MarketPlan {
  const windowDays = input.expiredWindowDays ?? DEFAULT_EXPIRED_WINDOW_DAYS
  const expiredRows = input.rows.filter((row) => ['EXP', 'EXPIRED'].includes(matrixStatusKey(row.statusRaw)))
  if (expiredRows.length > 0 && input.hasExpireColumn === false) {
    throw new Error('An expired Matrix row needs an expire or off-market date column.')
  }
  const exact = new Map<string, Hit>()
  const core = new Map<string, Hit>()
  const anyZip = new Map<string, Hit>()
  const byParcel = new Map<string, Hit>()
  const covered = new Set<string>()

  for (const row of input.rows) {
    if (row.zip5 && row.addrNorm) covered.add(row.zip5)
    const classified = classifyMatrixStatus(row.statusRaw, row, input.today, windowDays)
    if (!classified) continue
    const status: ListingStatus = classified === 'unmapped' ? 'listing_check_unknown' : classified
    const hit = hitFrom(row, status)
    if (row.parcelId) byParcel.set(row.parcelId, prefer(byParcel.get(row.parcelId), hit) as Hit)
    if (!row.addrNorm || !row.zip5) continue
    const exactKey = `${row.addrNorm}|${row.zip5}`
    exact.set(exactKey, prefer(exact.get(exactKey), hit) as Hit)
    const coreKey = `${coreMarketAddress(row.address)}|${row.zip5}`
    core.set(coreKey, prefer(core.get(coreKey), hit) as Hit)
    anyZip.set(row.addrNorm, prefer(anyZip.get(row.addrNorm), hit) as Hit)
  }

  const checks: MarketCheckDraft[] = []
  const tags: TagDraft[] = []
  const intakes: IntakeDraft[] = []
  const seenIntake = new Set<string>()
  const tagged = new Set<string>()

  function pushCheck(draft: Omit<MarketCheckDraft, 'source' | 'exportFileSha256'>): void {
    checks.push({ ...draft, source: 'heartland_matrix', exportFileSha256: input.fileSha256 })
  }

  function tag(poolRowId: string, mlsTag: TagDraft['mlsTag'], strategy: TagDraft['strategy'], key: string) {
    const id = `${poolRowId}:${mlsTag}`
    if (tagged.has(id)) return
    tagged.add(id)
    tags.push({ poolRowId, mlsTag, strategy, listDay: input.additionListDay, propertyKey: key })
  }

  for (const pool of input.poolRows) {
    const parcelId = normalizeParcelId(pool.parcelId) || null
    const addrNorm = normalizeMarketAddress(pool.address)
    const code = pool.zip5 || zip5(pool.address)
    const verdict = ownerNameVerdict(pool.rollOwner, pool.prospectOwner)
    const base = {
      parcelId,
      addrNorm,
      zip5: code,
      closeDate: null as string | null,
      listPrice: null as number | null,
      ownerOnRoll: pool.rollOwner,
      ownerChanged: verdict === 'changed',
      ownerCheckUnknown: verdict === 'unknown' || !parcelId,
    }
    const parcelHit = parcelId ? byParcel.get(parcelId) : undefined
    const sameZip = (addrNorm && code ? exact.get(`${addrNorm}|${code}`) : undefined)
      ?? (addrNorm && code ? core.get(`${coreMarketAddress(pool.address)}|${code}`) : undefined)
    const otherZip = addrNorm ? anyZip.get(addrNorm) : undefined
    const hit = prefer(parcelHit, sameZip)
    let status: ListingStatus
    if (!code && !hit) status = 'listing_check_unknown'
    else if (hit) status = hit.status
    else if (otherZip && otherZip.zip5 !== code) status = 'listing_check_unknown'
    else if (!addrNorm && !hit) status = 'listing_check_unknown'
    else if (!code || !covered.has(code)) status = 'listing_check_unknown'
    else if (input.allowOffMarket && input.completeFile) status = 'off_market_ok'
    else status = 'listing_check_unknown'

    if (hit && status !== 'listing_check_unknown' && status !== 'off_market_ok') {
      base.closeDate = hit.closeDate
      base.listPrice = hit.listPrice
      base.parcelId = base.parcelId ?? hit.parcelId
      base.addrNorm = base.addrNorm || hit.addrNorm
      base.zip5 = base.zip5 || hit.zip5
    }
    const key = propertyKey(base.parcelId, base.addrNorm, base.zip5)
    const listDay = status === 'off_market_ok' ? input.additionListDay : input.today
    pushCheck({
      ...base,
      listDay,
      mlsNumber: hit && status !== 'off_market_ok' && status !== 'listing_check_unknown' ? hit.mlsNumber : null,
      listStatusRaw: hit && status !== 'off_market_ok' && status !== 'listing_check_unknown' ? hit.raw : null,
      listingStatus: status,
      propertyKey: key || `row:${pool.id}`,
    })

    if (!hit || !intakeAllowed(input.targetStatusByZip.get(hit.zip5 || code))) continue
    if (hit.status === 'listing_expired') tag(pool.id, 'expired_listing', 'wholesale', key)
    if (hit.status === 'listed_active') {
      const floor = input.minListPriceByZip.get(hit.zip5)
      if (floor != null && hit.listPrice != null && hit.listPrice >= floor) {
        tag(pool.id, 'active_high_price', 'novation_traditional', key)
      }
    }
  }

  for (const row of input.rows) {
    if (!row.addrNorm || !row.zip5) continue
    if (!intakeAllowed(input.targetStatusByZip.get(row.zip5))) continue
    const parcelId = row.parcelId
    const merged = prefer(parcelId ? byParcel.get(parcelId) : undefined, exact.get(`${row.addrNorm}|${row.zip5}`))
    if (!merged || merged.status !== 'listing_expired') continue
    const key = propertyKey(parcelId, row.addrNorm, row.zip5)
    const already = input.poolRows.some((pool) => {
      const poolParcel = normalizeParcelId(pool.parcelId)
      const poolAddr = normalizeMarketAddress(pool.address)
      const poolZip = pool.zip5 || zip5(pool.address)
      return (parcelId && poolParcel === parcelId) || (poolAddr === row.addrNorm && poolZip === row.zip5)
    })
    if (already || seenIntake.has(key)) continue
    seenIntake.add(key)
    intakes.push({
      matchKey: poolMatchKey(parcelId, row.addrNorm, row.zip5),
      parcelId,
      address: row.address,
      addrNorm: row.addrNorm,
      zip5: row.zip5,
      mlsNumber: row.mlsNumber || null,
      listDay: input.additionListDay,
      county: 'jackson',
      state: 'MO',
      propertyKey: key,
    })
    if (!checks.some((check) => check.propertyKey === key && check.listingStatus === 'listing_expired')) {
      pushCheck({
        parcelId,
        addrNorm: row.addrNorm,
        zip5: row.zip5,
        listDay: input.today,
        mlsNumber: row.mlsNumber || null,
        listStatusRaw: row.statusRaw,
        listingStatus: 'listing_expired',
        closeDate: null,
        listPrice: row.listPrice,
        ownerOnRoll: null,
        ownerChanged: false,
        ownerCheckUnknown: true,
        propertyKey: key,
      })
    }
  }

  return { checks, tags, intakes, coveredZips: [...covered].sort() }
}

export function ksLicenseUnconfirmed(state: string | null | undefined): boolean {
  return (state ?? '').toUpperCase() === 'KS'
}

export function requiresLicenseeDisclosure(expiredSourced: boolean): boolean {
  return expiredSourced
}

const BLOCKING = new Set<ListingStatus>([
  'listed_active',
  'listed_pending',
  'sold_new_owner',
  'listing_check_unknown',
])

export function marketExportBlock(input: {
  enabled: boolean
  expiredSourced: boolean
  highPrice: boolean
  ownerChanged: boolean
  latestStatus: ListingStatus | null
  latestListDay: string | null
  today: string
  expiredOwnerConfirmed: boolean
  hasRelistCheckToday: boolean
  phoneBlockReason?: string | null
  lineChecksMerged?: boolean
  channel?: ExpiredContactChannel
}): string | null {
  if (!input.enabled) return null
  if (input.highPrice) return 'active_high_price'
  if (input.expiredSourced) {
    return expiredRowBlock({
      phoneBlockReason: input.phoneBlockReason ?? null,
      lineChecksMerged: input.lineChecksMerged,
      ownerChanged: input.ownerChanged,
      latestStatus: input.latestStatus,
      hasRelistCheckToday: input.hasRelistCheckToday,
      listDay: input.today,
      channel: input.channel ?? 'single_line_live_agent',
      expiredOwnerConfirmed: input.expiredOwnerConfirmed,
    })
  }
  if (input.ownerChanged) return 'owner_changed'
  if (input.latestStatus && BLOCKING.has(input.latestStatus)) return input.latestStatus
  if (input.latestStatus === 'off_market_ok' && input.latestListDay === input.today && !input.ownerChanged) return null
  return 'market_check_missing'
}
