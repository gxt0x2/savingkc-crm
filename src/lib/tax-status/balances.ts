import { parseCollectorBalance } from '@/lib/county-collector-balance'
import type { JacksonCountyTaxData } from '@/lib/county-enrichment-types'

/**
 * Live county balance used by the tax-status gate.
 * A historical list tag is never an input.
 */
export interface LiveTaxBalance {
  balance: number
  yearsOwed: number
  redeemed: boolean
}

export interface ClayInstallment {
  year: number
  balance: unknown
  noChargesDue?: boolean
  ok: boolean
}

const PRIOR_YEAR_MIN = 2000

function calendarYear(now: Date): number {
  return now.getFullYear()
}

function priorYear(year: number, now: Date): boolean {
  return year >= PRIOR_YEAR_MIN && year < calendarYear(now)
}

/** Jackson collector text. Same Total Due / Past Due reading Katherine's portal pull uses. */
export function parseJacksonTaxPortalText(text: string, now = new Date()): JacksonCountyTaxData & LiveTaxBalance {
  const totalDueMatch = text.match(/Total Due:\s*\$?([\d,]+\.?\d*)/)
  const taxOwed = totalDueMatch ? parseFloat(totalDueMatch[1].replace(/,/g, '')) : 0
  const isBankruptcy = text.includes('Bankruptcy')
  const redeemed = /\bredeemed\b/i.test(text)
  const taxStatus = redeemed
    ? 'redeemed'
    : taxOwed > 0
      ? (isBankruptcy ? 'bankruptcy' : 'delinquent')
      : 'current'

  const yearMatches = [...text.matchAll(/^(\d{4})\s*$/gm)]
  const uniqueYears = new Set(
    yearMatches.map((match) => parseInt(match[1], 10)).filter((year) => priorYear(year, now) || year === calendarYear(now)),
  )

  const delinquentBills: NonNullable<JacksonCountyTaxData['delinquentBills']> = []
  for (const section of text.split(/\n(?=\d{4}\s*\n)/)) {
    const yearMatch = section.match(/^(\d{4})\s*\n/)
    if (!yearMatch) continue
    const taxYear = parseInt(yearMatch[1], 10)
    if (taxYear < PRIOR_YEAR_MIN || taxYear > calendarYear(now)) continue
    const amounts = [...section.matchAll(/\$?([\d,]+\.\d{2})/g)].map((match) =>
      parseFloat(match[1].replace(/,/g, '')),
    )
    const status = section.includes('Past Due') ? 'Past Due' : section.includes('Current') ? 'Current' : 'Unknown'
    if (amounts.length >= 4) {
      delinquentBills.push({
        taxYear,
        billNumber: '1',
        totalCharges: amounts[0] || 0,
        totalPaid: amounts[amounts.length - 1] || 0,
        principal: amounts[0] || 0,
        penalty: amounts[1] || 0,
        interest: amounts[2] || 0,
        status,
      })
    }
  }

  const paymentMatches = [...text.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})[^$]*\$?([\d,]+\.\d{2})/g)]
  let lastPaymentDate: string | undefined
  let lastPaymentAmount: number | undefined
  if (paymentMatches.length > 0) {
    const last = paymentMatches[paymentMatches.length - 1]
    lastPaymentDate = last[1]
    lastPaymentAmount = parseFloat(last[2].replace(/,/g, ''))
  }

  const pastDueYears = delinquentBills.filter((bill) => bill.status === 'Past Due' && priorYear(bill.taxYear, now))
  const yearsOwed = pastDueYears.length > 0
    ? pastDueYears.length
    : [...uniqueYears].filter((year) => priorYear(year, now)).length

  return {
    taxOwed: taxOwed > 0 ? taxOwed : undefined,
    taxStatus,
    yearsDelinquent: yearsOwed > 0 ? yearsOwed : undefined,
    lastPaymentDate,
    lastPaymentAmount,
    delinquentBills: delinquentBills.length > 0 ? delinquentBills : undefined,
    isBankruptcy: isBankruptcy || undefined,
    balance: Number.isFinite(taxOwed) ? taxOwed : 0,
    yearsOwed,
    redeemed,
  }
}

/** Johnson taxbill.jocogov.org detail HTML. Same dollar labels as the county enrichment lookup. */
export function parseJohnsonTaxBillHtml(html: string, yearsHint = 0): LiveTaxBalance {
  const dollarVal = (label: string): number | undefined => {
    const match = html.match(new RegExp(`${label}[^$]*\\$([\\d,]+\\.\\d{2})`, 'i'))
    return match ? parseFloat(match[1].replace(/,/g, '')) : undefined
  }
  const totalDue = dollarVal('Total Due')
  const pastYearsDue = dollarVal('Past Years Due')
  const balance = totalDue ?? pastYearsDue ?? 0
  const yearHits = [...html.matchAll(/\b(20\d{2})\b/g)]
    .map((match) => Number(match[1]))
  const distinctPrior = new Set(yearHits).size
  const yearsOwed = yearsHint > 0
    ? yearsHint
    : (pastYearsDue ?? 0) > 0
      ? Math.max(1, distinctPrior)
      : 0
  return {
    balance: Number.isFinite(balance) ? balance : 0,
    yearsOwed,
    redeemed: /\bredeemed\b/i.test(html),
  }
}

/**
 * Clay collector installments. balance_amount may be a number or a formatted
 * string; both are parsed numerically (not concatenated).
 */
export function summarizeClayInstallments(rows: readonly ClayInstallment[], now = new Date()): LiveTaxBalance {
  let balance = 0
  const years = new Set<number>()
  let sawRedeemed = false
  for (const row of rows) {
    if (!row.ok) continue
    if (row.noChargesDue) continue
    if (!priorYear(row.year, now)) continue
    const amount = parseCollectorBalance(row.balance)
    if (amount > 0) {
      balance += amount
      years.add(row.year)
    }
  }
  if (rows.some((row) => row.ok && /\bredeemed\b/i.test(String(row.balance ?? '')))) sawRedeemed = true
  return { balance, yearsOwed: years.size, redeemed: sawRedeemed && balance === 0 }
}

export interface PlatteTaxRow {
  year: number
  amount: number
  paid: boolean
  redeemed?: boolean
}

/** Platte collector tax history. Unpaid prior years only. */
export function summarizePlatteTaxRows(rows: readonly PlatteTaxRow[], now = new Date()): LiveTaxBalance {
  const unpaid = rows.filter((row) => !row.paid && !row.redeemed && priorYear(row.year, now) && row.amount > 0)
  const balance = unpaid.reduce((sum, row) => sum + row.amount, 0)
  const redeemed = rows.some((row) => row.redeemed) && unpaid.length === 0
  return { balance, yearsOwed: unpaid.length, redeemed }
}

/** Wyandotte detail text. The assessor scraper has no balance; this reads a collector-style total when present. */
export function parseWyandotteTaxText(text: string, now = new Date()): LiveTaxBalance | null {
  if (!/Total Due|Past Due|Delinquent/i.test(text)) return null
  return parseJacksonTaxPortalText(text, now)
}
