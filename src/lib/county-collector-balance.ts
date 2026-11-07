/**
 * Clay County collector API returns balance_amount as a number on some parcels
 * and as a string ("1234.56", "1,234.56", "$1,234.56") on others. Parse both;
 * anything unparseable or non-finite is treated as 0.
 */
export function parseCollectorBalance(raw: unknown): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0
  if (typeof raw !== 'string') return 0
  const cleaned = raw.replace(/[$,\s]/g, '')
  if (cleaned === '' || !/^-?\d*\.?\d+$/.test(cleaned)) return 0
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : 0
}

/** Parsed balance, with a warning when a non-zero string could not be read. */
export function collectorBalanceOrWarn(raw: unknown, parcelNumber: string, year: number | string): number {
  const balance = parseCollectorBalance(raw)
  if (balance === 0 && typeof raw === 'string' && !/^[$\s0.,]*$/.test(raw)) {
    console.warn(`[clay-collector] Unparseable balance_amount for parcel ${parcelNumber} year ${year}:`, raw)
  }
  return balance
}
