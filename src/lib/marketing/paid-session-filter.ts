export type PaidSessionFilterRow = {
  lead_id?: string | null
  event_name?: string | null
  form_status?: string | null
  payload?: Record<string, unknown> | null
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function isBotTrackingRow(row: PaidSessionFilterRow): boolean {
  const payload = record(row.payload)
  const device = record(payload.device)
  const browser = record(payload.browser)
  const userAgent = [
    text(device.device_type),
    text(device.browser),
    text(browser.name),
    text(browser.browser),
    text(payload.user_agent),
    text(payload.userAgent),
  ].join(' ').toLowerCase()

  return /(bot|crawler|spider|preview|scraper)/.test(userAgent)
}

export function hasLeadSignal(row: PaidSessionFilterRow): boolean {
  return Boolean(row.lead_id) || text(row.event_name) === 'lead_submitted' || text(row.form_status) === 'submitted'
}

export function isBotOnlyPaidSession(rows: PaidSessionFilterRow[]): boolean {
  const hasLead = rows.some(hasLeadSignal)
  if (hasLead) return false
  return rows.length > 0 && rows.every(isBotTrackingRow)
}
