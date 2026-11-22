import { normalizeTwilioNumber } from '@/lib/twilio-numbers'

/** Direct mail drops (tracking gap G8). */
export type MailDropInput = {
  code: string
  name: string
  list_name: string | null
  county: string | null
  drop_date: string
  pieces: number
  cost: number | null
  piece_type: string | null
  response_number: string | null
  landing_path: string
  notes: string | null
}

export type MailDropPerformance = MailDropInput & {
  id: string
  web_visits: number
  leads: number
  phone_leads: number
  appointments: number
  contracts: number
  closes: number
  revenue: number
}

const SITE = 'https://savingkc.com'

/** A short, readable code from the drop name and date: "Jackson tax Nov" + 2026-11-24 → "jackson-tax-nov-1124". */
export function suggestMailDropCode(name: string, dropDate: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'mail'
  const md = /^\d{4}-(\d{2})-(\d{2})$/.exec(dropDate)
  return `${base}-${md ? md[1] + md[2] : 'drop'}`.replace(/^-/, '').slice(0, 40)
}

/** The URL printed (and QR-coded) on the piece. Visits from it are credited to the drop. */
export function mailDropUrl(drop: Pick<MailDropInput, 'code' | 'landing_path'>): string {
  const url = new URL(drop.landing_path || '/', SITE)
  url.searchParams.set('utm_source', 'direct_mail')
  url.searchParams.set('utm_medium', 'mail')
  url.searchParams.set('utm_campaign', drop.code)
  return url.toString()
}

function text(value: unknown, max: number): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null
}

function num(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.replace(/[$,]/g, '')) : NaN
  return Number.isFinite(n) && n >= 0 ? n : null
}

export function parseMailDropInput(body: unknown): { ok: true; value: MailDropInput } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Fill in the drop details.' }
  const b = body as Record<string, unknown>
  const name = text(b.name, 120)
  const dropDate = typeof b.drop_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.drop_date) ? b.drop_date : null
  if (!name) return { ok: false, error: 'Give the drop a name.' }
  if (!dropDate) return { ok: false, error: 'Pick the drop date.' }
  const pieces = num(b.pieces)
  if (pieces === null || !Number.isInteger(pieces)) return { ok: false, error: 'Enter how many pieces were mailed.' }
  const code = (text(b.code, 40) ?? suggestMailDropCode(name, dropDate)).toLowerCase()
  if (!/^[a-z0-9][a-z0-9-]{2,39}$/.test(code)) return { ok: false, error: 'The code can use lowercase letters, numbers and dashes (3–40).' }
  const rawNumber = text(b.response_number, 20)
  const responseNumber = rawNumber ? normalizeTwilioNumber(rawNumber) : null
  if (rawNumber && !responseNumber) return { ok: false, error: 'The response number must be a 10-digit US number.' }
  const path = text(b.landing_path, 120) ?? '/'
  if (!/^\/[A-Za-z0-9/_-]*$/.test(path)) return { ok: false, error: 'The landing page must be a site path like /sell-my-house/.' }
  return {
    ok: true,
    value: {
      code,
      name,
      list_name: text(b.list_name, 120),
      county: text(b.county, 60),
      drop_date: dropDate,
      pieces,
      cost: num(b.cost),
      piece_type: text(b.piece_type, 60),
      response_number: responseNumber,
      landing_path: path,
      notes: text(b.notes, 500),
    },
  }
}

/** Response rate and cost per lead, or null where the inputs do not allow it. */
export function mailDropRates(row: Pick<MailDropPerformance, 'pieces' | 'cost' | 'leads' | 'web_visits'>) {
  const responses = row.leads
  return {
    responseRate: row.pieces > 0 ? responses / row.pieces : null,
    costPerLead: row.cost !== null && row.leads > 0 ? row.cost / row.leads : null,
    visitRate: row.pieces > 0 ? row.web_visits / row.pieces : null,
  }
}
