import { encode } from 'gpt-tokenizer'
import type { ManifestV2_1 } from './schema'

export interface RenderPreCallOptions {
  token_budget?: number
  now?: Date
}

const DEFAULT_BUDGET = 1500

// ─── Formatters ───────────────────────────────────────────────────────────
const money = (n: number | null | undefined): string | null => {
  if (n === null || n === undefined) return null
  return `$${n.toLocaleString('en-US')}`
}

const relativeDays = (iso: string | null | undefined, now: Date): string | null => {
  if (!iso) return null
  const then = new Date(iso)
  if (isNaN(then.getTime())) return null
  const days = Math.floor((now.getTime() - then.getTime()) / 86_400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 0) return `in ${-days} day${-days === 1 ? '' : 's'}`
  return `${days} day${days === 1 ? '' : 's'} ago`
}

const shortDate = (iso: string, now: Date): string => {
  const d = new Date(iso)
  const month = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })
  const day = d.getUTCDate()
  const yr = d.getUTCFullYear()
  return yr === now.getUTCFullYear() ? `${month} ${day}` : `${month} ${day}, ${yr}`
}

const pending = (v: unknown): v is 'pending' => v === 'pending'

// ─── Token counting ───────────────────────────────────────────────────────
const countTokens = (text: string): number => encode(text).length

// ─── Section builders ─────────────────────────────────────────────────────
// Each builder returns an array of lines (no trailing newline). An empty
// array means the section is omitted. The orchestrator assembles sections
// and trims as needed to fit the budget.

type Section = {
  name: string
  lines: string[]
  trimmable: boolean
}

function buildHeader(m: ManifestV2_1): string[] {
  const lines: string[] = []
  lines.push(`# Pre-Call Briefing — ${m.seller.full_name}`)
  lines.push('')

  const prop = m.property
  const addr = [prop.address_line_1, prop.city].filter(Boolean).join(', ')
  lines.push(`**Property:** ${addr}, ${prop.state} (${prop.county} County)`)

  const pipe = m.pipeline
  lines.push(`**Station:** ${pipe.current_station} — Day ${pipe.days_in_current_station}`)

  const parts: string[] = [`**Priority:** ${pipe.priority}`]
  if (m.motivation && !pending(m.motivation) && typeof m.motivation === 'object') {
    parts.push(`**Motivation:** ${m.motivation.score}/10`)
  }
  lines.push(parts.join(' | '))
  return lines
}

function buildWhatToDo(m: ManifestV2_1): string[] {
  if (m.next_action === 'pending') {
    return ['## What to do on this call', '', '_Evaluation in progress._']
  }
  const na = m.next_action
  return [
    '## What to do on this call',
    '',
    `**${na.description}**`,
    '',
    na.reasoning,
  ]
}

function buildSellerSnapshot(m: ManifestV2_1): string[] {
  const out: string[] = ['## Seller snapshot', '']
  const items: string[] = []

  if (m.motivation) {
    items.push(`- **${m.motivation.primary_driver}** (primary driver)`)
    if (m.motivation.secondary_drivers) {
      items.push(`- Secondary: ${m.motivation.secondary_drivers.join(', ')}`)
    }
  }
  if (m.situation) {
    if (m.situation.timeline_raw) {
      const days = m.situation.timeline_normalized_days
      items.push(`- Timeline: ${m.situation.timeline_raw}${days ? ` (${days} days)` : ''}`)
    }
    if (m.situation.life_event_type !== 'none') {
      items.push(`- Life event: ${m.situation.life_event_type}`)
    }
  }
  if (m.personality) {
    items.push(`- Personality: ${m.personality.type}, ${m.personality.communication_style}`)
    if (m.personality.best_approach) {
      items.push(`- Best approach: **${m.personality.best_approach}**`)
    }
  }
  if (items.length === 0) return []
  return [...out, ...items]
}

function buildFinancials(m: ManifestV2_1): string[] {
  const f = m.financials
  const items: string[] = []

  const asking = money(f.seller_asking_price)
  if (asking) items.push(`- Seller asking: **${asking}**`)
  const floor = money(f.seller_floor_price)
  if (floor) items.push(`- Seller floor (our estimate): ${floor}`)
  const max = money(f.our_max_offer)
  if (max) items.push(`- Our max offer: ${max}`)
  const mort = money(f.mortgage_balance)
  if (mort) items.push(`- Mortgage: ${mort}`)
  const tax = money(f.back_taxes_owed)
  if (tax && f.back_taxes_owed !== 0) items.push(`- Back taxes: ${tax}`)
  const spread = money(f.estimated_spread)
  if (spread !== null) {
    const floorFlag = f.spread_meets_25k_floor === true
      ? ' ✓ clears $25K floor'
      : f.spread_meets_25k_floor === false
        ? ' ✗ below $25K floor'
        : ''
    items.push(`- Estimated spread: **${spread}**${floorFlag}`)
  }

  if (items.length === 0) return []
  return ['## Financials at a glance', '', ...items]
}

function buildObjections(m: ManifestV2_1): string[] {
  if (!m.situation?.objections) return []
  const sorted = [...m.situation.objections].sort((a, b) => {
    // Unaddressed first
    if (a.addressed !== b.addressed) return a.addressed ? 1 : -1
    return 0
  })
  const items: string[] = []
  for (const obj of sorted) {
    items.push(`- **[${obj.category}]** ${obj.stated}`)
    const note = obj.addressed ? (obj.resolution_notes ?? 'Addressed.') : 'Unaddressed.'
    items.push(`  ↳ ${note}`)
  }
  return ['## Open objections', '', ...items]
}

function buildLeverage(m: ManifestV2_1): string[] {
  if (!m.situation?.opportunity_flags) return []
  const items = m.situation.opportunity_flags.map((f) => `- ${f.label}${f.notes ? ` — ${f.notes}` : ''}`)
  return ['## Key leverage points', '', ...items]
}

function buildRedFlags(m: ManifestV2_1, topOnly = false): string[] {
  if (!m.situation?.red_flags) return []
  const sevOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const sorted = [...m.situation.red_flags].sort(
    (a, b) => (sevOrder[a.severity] ?? 9) - (sevOrder[b.severity] ?? 9),
  )
  const slice = topOnly ? sorted.slice(0, 1) : sorted
  const items = slice.map(
    (r) => `- **[${r.severity}]** ${r.label}${r.notes ? ` — ${r.notes}` : ''}`,
  )
  return ['## Red flags', '', ...items]
}

function buildQuotes(m: ManifestV2_1, now: Date, maxQuotes: number): string[] {
  if (!m.motivation?.key_quotes) return []
  const slice = m.motivation.key_quotes.slice(0, maxQuotes)
  const items: string[] = []
  for (const q of slice) {
    items.push(`> "${q.quote}"`)
    // No call timestamp lookup without source hydration; label with call id only.
    items.push(`> — Call ${q.source_call_id.slice(0, 8)}…`)
    items.push('')
  }
  if (items.length === 0) return []
  return ['## Voice of the seller', '', ...items]
}

function buildContext(m: ManifestV2_1, now: Date, keepObjResolutions = true): string[] {
  const items: string[] = []
  const lastContact = relativeDays(m.pipeline.last_meaningful_contact_at, now)
  if (lastContact) items.push(`- Last meaningful contact: ${lastContact}`)
  if (m.pipeline.next_scheduled_contact_at) {
    items.push(`- Next scheduled: ${shortDate(m.pipeline.next_scheduled_contact_at, now)}`)
  } else {
    items.push('- Next scheduled: none scheduled')
  }
  const c = m.completeness
  items.push(`- Data completeness: ${c.percent}% (${c.required_fields_present}/${c.required_fields_total})`)
  if (c.missing_fields) {
    items.push(`- Missing: ${c.missing_fields.join(', ')}`)
  }
  if (m.hot_eligibility) {
    let verdictLine = `- Hot Opportunity verdict: ${m.hot_eligibility.verdict}`
    if (
      m.hot_eligibility.verdict === 'ineligible_data_gap' &&
      m.hot_eligibility.missing_fields_for_gate
    ) {
      verdictLine += ` — need: ${m.hot_eligibility.missing_fields_for_gate.join(', ')}`
    }
    items.push(verdictLine)
  }
  if (items.length === 0) return []
  // suppress unused
  void keepObjResolutions
  return ['## Context flags', '', ...items]
}

function buildFreshness(m: ManifestV2_1, now: Date): string[] {
  const lines: string[] = ['## Briefing freshness', '']
  lines.push(`Generated at ${now.toISOString()}.`)
  const rel = relativeDays(m.meta.updated_at, now)
  if (rel) lines.push(`Manifest updated ${rel}.`)
  if (m.meta.briefing_stale) {
    lines.push('')
    lines.push('⚠️ Briefing flagged stale — verify critical fields before call.')
  }
  return lines
}

// ─── Assembly + trimming ──────────────────────────────────────────────────

interface TrimState {
  dropAllButTopRedFlag: boolean
  maxQuotes: number
  dropContext: boolean
  keepObjResolutions: boolean
  dropSecondary: boolean
  dropFreshness: boolean
}

const TRIM_NONE: TrimState = {
  dropAllButTopRedFlag: false,
  maxQuotes: 3,
  dropContext: false,
  keepObjResolutions: true,
  dropSecondary: false,
  dropFreshness: false,
}

// Trim order per spec: 1) top-severity red flag only, 2) 1 quote only,
// 3) drop Context, 4) drop objection resolutions, 5) drop secondary drivers,
// 6) drop freshness. First 4 sections (header, what-to-do, seller snapshot,
// financials) are never trimmed.
const TRIM_STEPS: Array<(s: TrimState) => void> = [
  (s) => { s.dropAllButTopRedFlag = true },
  (s) => { s.maxQuotes = 1 },
  (s) => { s.dropContext = true },
  (s) => { s.keepObjResolutions = false },
  (s) => { s.dropSecondary = true },
  (s) => { s.dropFreshness = true },
]

function assemble(m: ManifestV2_1, now: Date, trim: TrimState): { text: string; trims: string[] } {
  // Apply a trimmed copy so we don't mutate the source.
  const working: ManifestV2_1 = JSON.parse(JSON.stringify(m))
  const trims: string[] = []

  if (trim.dropSecondary && working.motivation?.secondary_drivers) {
    working.motivation.secondary_drivers = null
    trims.push('secondary_drivers')
  }
  if (!trim.keepObjResolutions && working.situation?.objections) {
    working.situation.objections = working.situation.objections.map((o) =>
      o.addressed ? { ...o, resolution_notes: null } : o,
    )
    trims.push('objection_resolutions')
  }

  const sections: Section[] = [
    { name: 'header', lines: buildHeader(working), trimmable: false },
    { name: 'what_to_do', lines: buildWhatToDo(working), trimmable: false },
    { name: 'seller_snapshot', lines: buildSellerSnapshot(working), trimmable: false },
    { name: 'financials', lines: buildFinancials(working), trimmable: false },
    { name: 'objections', lines: buildObjections(working), trimmable: true },
    { name: 'leverage', lines: buildLeverage(working), trimmable: true },
    { name: 'red_flags', lines: buildRedFlags(working, trim.dropAllButTopRedFlag), trimmable: true },
    { name: 'quotes', lines: buildQuotes(working, now, trim.maxQuotes), trimmable: true },
  ]
  if (!trim.dropContext) {
    sections.push({ name: 'context', lines: buildContext(working, now), trimmable: true })
  } else {
    trims.push('context')
  }
  if (!trim.dropFreshness) {
    sections.push({ name: 'freshness', lines: buildFreshness(working, now), trimmable: true })
  } else {
    trims.push('freshness')
  }
  if (trim.dropAllButTopRedFlag) trims.push('red_flags_trimmed_to_top')
  if (trim.maxQuotes < 3) trims.push(`quotes_to_${trim.maxQuotes}`)

  // Join sections with --- horizontal rule separators per template.
  const blocks = sections
    .filter((s) => s.lines.length > 0)
    .map((s) => s.lines.join('\n'))
  const text = blocks.join('\n\n---\n\n') + '\n'
  return { text, trims }
}

export function renderPreCallBriefing(
  manifest: ManifestV2_1,
  options: RenderPreCallOptions = {},
): string {
  const now = options.now ?? new Date()
  const budget = options.token_budget ?? DEFAULT_BUDGET

  const trim: TrimState = { ...TRIM_NONE }
  let { text, trims } = assemble(manifest, now, trim)

  for (const step of TRIM_STEPS) {
    if (countTokens(text) <= budget) break
    step(trim)
    ;({ text, trims } = assemble(manifest, now, trim))
  }

  if (trims.length > 0) {
    console.log(
      `[renderPreCallBriefing] manifest=${manifest.manifest_id} trimmed=[${trims.join(', ')}] tokens=${countTokens(text)}`,
    )
  }
  return text
}
