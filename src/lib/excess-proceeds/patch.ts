import {
  COUNSEL_STATUSES,
  FORM_PACK_STATUSES,
  type CounselStatus,
  type ExcessProceedsPatch,
  type FormPackStatus,
} from '@/types/excess-proceeds'

const DATE_FIELDS = [
  'sale_date',
  'confirmed_date',
  'deed_date',
  'set_aside_date',
  'refund_date',
  'excess_application_filed_date',
  'excess_denied_date',
  'excess_paid_date',
  'zestimate_as_of',
] as const

const MONEY_FIELDS = ['purchase_price', 'judgment_amount', 'excess_amount', 'zestimate'] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function dateValue(value: unknown): string | null | undefined {
  if (value === null) return null
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return value
}

function moneyValue(value: unknown): number | null | undefined {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100_000_000) return undefined
  return Math.round(value * 100) / 100
}

export function buildExcessProceedsPatch(input: unknown): { ok: true; patch: ExcessProceedsPatch } | { ok: false; error: string } {
  if (!isRecord(input)) return { ok: false, error: 'Update command required' }
  const patch: ExcessProceedsPatch = {}

  for (const field of DATE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue
    const value = dateValue(input[field])
    if (value === undefined) return { ok: false, error: `Invalid ${field.replaceAll('_', ' ')}` }
    patch[field] = value
  }
  for (const field of MONEY_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(input, field)) continue
    const value = moneyValue(input[field])
    if (value === undefined) return { ok: false, error: `Invalid ${field.replaceAll('_', ' ')}` }
    patch[field] = value
  }
  if (Object.prototype.hasOwnProperty.call(input, 'score')) {
    if (input.score === null) patch.score = null
    else if (typeof input.score !== 'number' || !Number.isFinite(input.score) || input.score < 0 || input.score > 1000) {
      return { ok: false, error: 'Invalid score' }
    } else patch.score = input.score
  }
  if (Object.prototype.hasOwnProperty.call(input, 'surplus_fee_pct')) {
    if (typeof input.surplus_fee_pct !== 'number' || !Number.isFinite(input.surplus_fee_pct) || input.surplus_fee_pct < 0 || input.surplus_fee_pct > 100) {
      return { ok: false, error: 'Surplus fee percent must be between 0 and 100' }
    }
    patch.surplus_fee_pct = input.surplus_fee_pct
  }
  if (Object.prototype.hasOwnProperty.call(input, 'payout_ready')) {
    if (typeof input.payout_ready !== 'boolean') return { ok: false, error: 'Payout ready must be yes or no' }
    patch.payout_ready = input.payout_ready
  }
  if (Object.prototype.hasOwnProperty.call(input, 'owner_is_entity')) {
    if (typeof input.owner_is_entity !== 'boolean') return { ok: false, error: 'Owner is entity must be yes or no' }
    patch.owner_is_entity = input.owner_is_entity
  }
  if (Object.prototype.hasOwnProperty.call(input, 'counsel_status')) {
    if (!(COUNSEL_STATUSES as readonly string[]).includes(String(input.counsel_status))) {
      return { ok: false, error: 'Counsel status must be pending, clear, or blocked' }
    }
    patch.counsel_status = input.counsel_status as CounselStatus
  }
  if (Object.prototype.hasOwnProperty.call(input, 'form_pack_status')) {
    if (!(FORM_PACK_STATUSES as readonly string[]).includes(String(input.form_pack_status))) {
      return { ok: false, error: 'Form pack status must be none, drafted, or signed' }
    }
    patch.form_pack_status = input.form_pack_status as FormPackStatus
  }
  if (Object.prototype.hasOwnProperty.call(input, 'form_pack_url')) {
    if (input.form_pack_url === null || input.form_pack_url === '') patch.form_pack_url = null
    else if (typeof input.form_pack_url !== 'string' || !/^https?:\/\//i.test(input.form_pack_url) || input.form_pack_url.length > 500) {
      return { ok: false, error: 'Drive form pack link must be an http(s) URL' }
    } else patch.form_pack_url = input.form_pack_url.trim()
  }

  const touchesEstimate = Object.prototype.hasOwnProperty.call(patch, 'zestimate') || Object.prototype.hasOwnProperty.call(patch, 'zestimate_as_of')
  if (touchesEstimate) {
    const amount = patch.zestimate ?? null
    const asOf = patch.zestimate_as_of ?? null
    if ((amount === null) !== (asOf === null)) {
      return { ok: false, error: 'Zestimate needs both a value and an as-of date, or both cleared.' }
    }
    patch.zestimate = amount
    patch.zestimate_as_of = asOf
  }

  if (Object.keys(patch).length === 0) return { ok: false, error: 'At least one excess-proceeds field is required' }
  return { ok: true, patch }
}
