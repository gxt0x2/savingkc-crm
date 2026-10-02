export class WholesaleMarketSnapshotError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WholesaleMarketSnapshotError'
  }
}

export type MoiBand = 'Tight' | 'Balanced' | 'Soft'

export type WholesaleZip = {
  zip: string
  county: string
  solds: number
  median_close: number
  actives: number
  moi: number
  median_dom: number
  rank: number
  flags: string[]
  primary_target: boolean
}

export type CountyRollup = {
  county: string
  fit_zips: number
  sum_solds: number
  sum_actives: number
  median_of_medians: number
  median_of_medians_label: string
  avg_moi: number
  kcrar: {
    closed_sales: number
    median_sales_price: number
    dom: number
    supply_moi: number
    inventory: number
  }
}

export type MarketInsight = {
  kind: string
  zip: string
  metric: string
  detail: string
}

export type WholesaleMarketSnapshot = {
  meta: {
    title: string
    subtitle: string
    month: string
    month_key: string
    as_of: string
    source_badge: string
    generated_at: string
    primary_target_rule: string
    methodology: string[]
    data_gaps: string[]
    flags_rules?: Record<string, string>
  }
  summary: {
    sold_records: number
    active_records: number
    sold_median_close: number
    sold_median_dom: number
    fit_zip_count: number
    metro_moi: number
    primary_target_count: number
  }
  insights: MarketInsight[]
  counties: CountyRollup[]
  kcrar_meta: {
    as_of: string
    source: string
    label: string
  }
  zips: WholesaleZip[]
}

export type ZipSortColumn = 'rank' | 'zip' | 'county' | 'solds' | 'median_close' | 'actives' | 'moi' | 'median_dom'
export type SortDirection = 'asc' | 'desc'

const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/
const ZIP_CODE = /^\d{5}$/
const STRING_SORTS = new Set<ZipSortColumn>(['zip', 'county'])

export function matchesPrimaryTargetRule(zip: Pick<WholesaleZip, 'flags' | 'solds'>): boolean {
  return zip.flags.includes('Tight') || (zip.flags.includes('Balanced') && zip.solds >= 35)
}

export function parseWholesaleMarketSnapshot(value: unknown): WholesaleMarketSnapshot {
  const root = record(value, 'snapshot')
  const meta = record(root.meta, 'meta')
  const summary = record(root.summary, 'summary')
  const monthKey = text(meta.month_key, 'meta.month_key')
  if (!MONTH_KEY.test(monthKey)) {
    throw new WholesaleMarketSnapshotError('meta.month_key must be YYYY-MM')
  }

  const methodology = textList(meta.methodology, 'meta.methodology')
  const methodologyText = methodology.join('\n').toLowerCase()
  if (!methodologyText.includes('moi') || !methodologyText.includes('200')) {
    throw new WholesaleMarketSnapshotError('Methodology must state MOI and the $200k–$400k fit band')
  }
  if (!methodologyText.includes('64125') || !methodologyText.includes('64131')) {
    throw new WholesaleMarketSnapshotError('Methodology must state the 64125–64129 avoid and 64131 park rules')
  }
  if (!methodologyText.includes('lead')) {
    throw new WholesaleMarketSnapshotError('Methodology must say these zips are not CRM leads')
  }

  const zips = list(root.zips, 'zips').map((entry, index) => parseZip(entry, index))
  const fitZipCount = finite(summary.fit_zip_count, 'summary.fit_zip_count')
  if (zips.length !== fitZipCount) {
    throw new WholesaleMarketSnapshotError(`fit_zip_count is ${fitZipCount} but the snapshot has ${zips.length} zips`)
  }
  const primaryCount = zips.filter((zip) => zip.primary_target).length
  const declaredPrimary = finite(summary.primary_target_count, 'summary.primary_target_count')
  if (primaryCount !== declaredPrimary) {
    throw new WholesaleMarketSnapshotError(`primary_target_count is ${declaredPrimary} but ${primaryCount} zips are primary targets`)
  }

  finite(summary.sold_records, 'summary.sold_records')
  finite(summary.active_records, 'summary.active_records')
  finite(summary.sold_median_close, 'summary.sold_median_close')
  finite(summary.sold_median_dom, 'summary.sold_median_dom')
  finite(summary.metro_moi, 'summary.metro_moi')

  const insights = list(root.insights, 'insights').map((entry, index) => {
    const insight = record(entry, `insights[${index}]`)
    return {
      kind: text(insight.kind, `insights[${index}].kind`),
      zip: text(insight.zip, `insights[${index}].zip`),
      metric: text(insight.metric, `insights[${index}].metric`),
      detail: text(insight.detail, `insights[${index}].detail`),
    }
  })
  if (insights.length < 1) throw new WholesaleMarketSnapshotError('At least one analyst insight is required')

  const counties = list(root.counties, 'counties').map((entry, index) => parseCounty(entry, index))
  if (counties.length < 1) throw new WholesaleMarketSnapshotError('At least one county rollup is required')

  const kcrar = record(root.kcrar_meta, 'kcrar_meta')
  return {
    meta: {
      title: text(meta.title, 'meta.title'),
      subtitle: text(meta.subtitle, 'meta.subtitle'),
      month: text(meta.month, 'meta.month'),
      month_key: monthKey,
      as_of: text(meta.as_of, 'meta.as_of'),
      source_badge: text(meta.source_badge, 'meta.source_badge'),
      generated_at: text(meta.generated_at, 'meta.generated_at'),
      primary_target_rule: text(meta.primary_target_rule, 'meta.primary_target_rule'),
      methodology,
      data_gaps: textList(meta.data_gaps, 'meta.data_gaps'),
      flags_rules: meta.flags_rules && typeof meta.flags_rules === 'object' ? meta.flags_rules as Record<string, string> : undefined,
    },
    summary: {
      sold_records: finite(summary.sold_records, 'summary.sold_records'),
      active_records: finite(summary.active_records, 'summary.active_records'),
      sold_median_close: finite(summary.sold_median_close, 'summary.sold_median_close'),
      sold_median_dom: finite(summary.sold_median_dom, 'summary.sold_median_dom'),
      fit_zip_count: fitZipCount,
      metro_moi: finite(summary.metro_moi, 'summary.metro_moi'),
      primary_target_count: declaredPrimary,
    },
    insights,
    counties,
    kcrar_meta: {
      as_of: text(kcrar.as_of, 'kcrar_meta.as_of'),
      source: text(kcrar.source, 'kcrar_meta.source'),
      label: text(kcrar.label, 'kcrar_meta.label'),
    },
    zips,
  }
}

export function filterWholesaleZips(zips: readonly WholesaleZip[], filters: {
  query: string
  county: string
  moiBand: '' | MoiBand
  primaryOnly: boolean
}): WholesaleZip[] {
  const query = filters.query.trim()
  return zips.filter((zip) => {
    if (query && !zip.zip.includes(query)) return false
    if (filters.county && zip.county !== filters.county) return false
    if (filters.moiBand && !zip.flags.includes(filters.moiBand)) return false
    if (filters.primaryOnly && !zip.primary_target) return false
    return true
  })
}

export function sortWholesaleZips(zips: readonly WholesaleZip[], column: ZipSortColumn, direction: SortDirection): WholesaleZip[] {
  const sign = direction === 'asc' ? 1 : -1
  return zips.toSorted((left, right) => {
    const leftValue = left[column]
    const rightValue = right[column]
    if (typeof leftValue === 'string' || typeof rightValue === 'string') {
      const compared = String(leftValue).localeCompare(String(rightValue), 'en', { sensitivity: 'base' })
      if (compared !== 0) return compared * sign
    } else if (leftValue !== rightValue) {
      return leftValue < rightValue ? -sign : sign
    }
    return left.rank - right.rank
  })
}

export function nextZipSort(current: { column: ZipSortColumn; direction: SortDirection }, column: ZipSortColumn) {
  if (current.column === column) {
    return { column, direction: current.direction === 'asc' ? 'desc' as const : 'asc' as const }
  }
  return { column, direction: STRING_SORTS.has(column) ? 'asc' as const : 'desc' as const }
}

export function formatCount(value: number): string {
  return Number(value).toLocaleString('en-US')
}

export function formatMoney(value: number): string {
  return `$${Math.round(value).toLocaleString('en-US')}`
}

export function formatMoi(value: number): string {
  return Number(value).toFixed(2)
}

export function formatDom(value: number): string {
  return Number(value).toLocaleString('en-US', { maximumFractionDigits: 1 })
}

export function mergeWholesaleMarketSnapshots(bundled: readonly WholesaleMarketSnapshot[], stored: readonly WholesaleMarketSnapshot[]): WholesaleMarketSnapshot[] {
  const byMonth = new Map<string, WholesaleMarketSnapshot>()
  for (const snapshot of bundled) byMonth.set(snapshot.meta.month_key, snapshot)
  for (const snapshot of stored) byMonth.set(snapshot.meta.month_key, snapshot)
  return [...byMonth.values()].sort((left, right) => right.meta.month_key.localeCompare(left.meta.month_key))
}

function parseZip(value: unknown, index: number): WholesaleZip {
  const zip = record(value, `zips[${index}]`)
  const code = text(zip.zip, `zips[${index}].zip`)
  if (!ZIP_CODE.test(code)) throw new WholesaleMarketSnapshotError(`zips[${index}].zip must be a 5-digit ZIP`)
  const flags = list(zip.flags, `zips[${index}].flags`).map((flag, flagIndex) => text(flag, `zips[${index}].flags[${flagIndex}]`))
  const solds = finite(zip.solds, `zips[${index}].solds`)
  if (typeof zip.primary_target !== 'boolean') {
    throw new WholesaleMarketSnapshotError(`zips[${index}].primary_target must be true or false`)
  }
  if (zip.primary_target !== matchesPrimaryTargetRule({ flags, solds })) {
    throw new WholesaleMarketSnapshotError(`ZIP ${code} primary_target does not match Tight OR (Balanced AND solds ≥ 35)`)
  }
  return {
    zip: code,
    county: text(zip.county, `zips[${index}].county`),
    solds,
    median_close: finite(zip.median_close, `zips[${index}].median_close`),
    actives: finite(zip.actives, `zips[${index}].actives`),
    moi: finite(zip.moi, `zips[${index}].moi`),
    median_dom: finite(zip.median_dom, `zips[${index}].median_dom`),
    rank: finite(zip.rank, `zips[${index}].rank`),
    flags,
    primary_target: zip.primary_target,
  }
}

function parseCounty(value: unknown, index: number): CountyRollup {
  const county = record(value, `counties[${index}]`)
  const kcrar = record(county.kcrar, `counties[${index}].kcrar`)
  return {
    county: text(county.county, `counties[${index}].county`),
    fit_zips: finite(county.fit_zips, `counties[${index}].fit_zips`),
    sum_solds: finite(county.sum_solds, `counties[${index}].sum_solds`),
    sum_actives: finite(county.sum_actives, `counties[${index}].sum_actives`),
    median_of_medians: finite(county.median_of_medians, `counties[${index}].median_of_medians`),
    median_of_medians_label: text(county.median_of_medians_label, `counties[${index}].median_of_medians_label`),
    avg_moi: finite(county.avg_moi, `counties[${index}].avg_moi`),
    kcrar: {
      closed_sales: finite(kcrar.closed_sales, `counties[${index}].kcrar.closed_sales`),
      median_sales_price: finite(kcrar.median_sales_price, `counties[${index}].kcrar.median_sales_price`),
      dom: finite(kcrar.dom, `counties[${index}].kcrar.dom`),
      supply_moi: finite(kcrar.supply_moi, `counties[${index}].kcrar.supply_moi`),
      inventory: finite(kcrar.inventory, `counties[${index}].kcrar.inventory`),
    },
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new WholesaleMarketSnapshotError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function list(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new WholesaleMarketSnapshotError(`${label} must be a list`)
  return value
}

function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new WholesaleMarketSnapshotError(`${label} is required`)
  }
  return value
}

function textList(value: unknown, label: string): string[] {
  return list(value, label).map((entry, index) => text(entry, `${label}[${index}]`))
}

function finite(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new WholesaleMarketSnapshotError(`${label} must be a number`)
  }
  return value
}
