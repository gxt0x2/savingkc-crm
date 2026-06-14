export type LeadAlertDelivery = {
  target: string | null
  to: string | null
  success: boolean
  sid: string | null
  error: string | null
  status: string | null
}

export type LeadAlertCallbackCall = {
  agentName: string | null
  to: string | null
  started: boolean
  sid: string | null
  error: string | null
}

export type LeadAlertCallback = {
  started: boolean
  sid: string | null
  to: string | null
  batchId: string | null
  calls: LeadAlertCallbackCall[]
  error: string | null
}

export type LeadAlertCallbackResolution = {
  claimedBy: string | null
  claimedAt: string | null
  outcome: 'connected' | 'missed' | null
  outcomeAt: string | null
  dialStatus: string | null
}

export type LeadAlertSummaryInput = {
  recipients: string[]
  delivery: LeadAlertDelivery[]
  callback: LeadAlertCallback | null
  callbackResolution: LeadAlertCallbackResolution
  trigger: string | null
  trafficSource: string | null
}

export type LeadAlertSummary = {
  total: number
  smsSucceeded: number
  smsFailed: number
  callbacksStarted: number
  callbacksClaimed: number
  callbacksConnected: number
  noRecipients: number
  ernestIncluded: number
  caseyIncluded: number
  googleAds: number
  formAlerts: number
  callAlerts: number
}

export type LeadAlertActivityLike = {
  lead_id: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function bool(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  return ['true', '1', 'yes'].includes(text(value).toLowerCase())
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record).filter((item) => Object.keys(item).length > 0) : []
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(text).filter(Boolean)
}

function digits(value: string | null): string {
  return (value || '').replace(/\D/g, '')
}

function byPhone(phone: string | null, phones: string[]): string | null {
  const clean = digits(phone)
  if (!clean) return null
  return phones.find((candidate) => {
    const candidateDigits = digits(candidate)
    return candidateDigits === clean || candidateDigits.endsWith(clean) || clean.endsWith(candidateDigits)
  }) || null
}

export function isLeadAlertMetadata(metadata: unknown): boolean {
  const meta = record(metadata)
  const trigger = text(meta.trigger).toLowerCase()
  return (
    text(meta.direction).toLowerCase() === 'outbound_alert'
    || records(meta.delivery_status).length > 0
    || strings(meta.to_agents).length > 0
    || trigger.endsWith('_alert')
    || trigger.includes('lead_alert')
    || trigger.includes('google_ads_inbound_call')
  )
}

export function alertTriggerLabel(trigger: string | null): string {
  const value = (trigger || '').trim()
  if (!value) return 'Lead alert'
  const normalized = value.toLowerCase()
  if (normalized === 'ppc_lead_alert') return 'PPC form lead'
  if (normalized === 'website_lead_alert') return 'Website form lead'
  if (normalized === 'google_ads_inbound_call_started') return 'Google Ads call started'
  if (normalized === 'google_ads_missed_call_followup') return 'Google Ads missed-call followup'
  if (normalized === 'known_missed_call_alert') return 'Known missed call'
  if (normalized === 'unknown_missed_call_alert') return 'Unknown missed call'
  if (normalized === 'booking_alert') return 'Appointment booking'
  if (normalized === 'mojo_hot_lead_alert') return 'Mojo hot lead'
  if (normalized === 'yes_reply_alert') return 'Seller replied yes'
  if (normalized === 'prospect_sms_alert') return 'Prospect SMS'
  if (normalized === 'unknown_sms_alert') return 'Unknown SMS'
  return value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function alertChannel(trigger: string | null): 'form' | 'call' | 'sms' | 'booking' | 'other' {
  const value = (trigger || '').toLowerCase()
  if (value.includes('form') || value.includes('lead_alert')) return 'form'
  if (value.includes('call') || value.includes('ivr') || value.includes('voicemail')) return 'call'
  if (value.includes('sms') || value.includes('reply')) return 'sms'
  if (value.includes('booking') || value.includes('appointment')) return 'booking'
  return 'other'
}

export function normalizeLeadAlertDelivery(metadata: unknown): LeadAlertDelivery[] {
  const meta = record(metadata)
  const recipients = strings(meta.to_agents)
  const phones = strings(meta.to_agent_phones)

  return records(meta.delivery_status).map((entry, index) => {
    const nested = record(entry.value)
    const status = text(entry.status) || text(nested.status) || null
    const explicitSuccess = entry.success === true || nested.success === true
    const explicitFailure = entry.success === false || nested.success === false || Boolean(text(entry.error) || text(nested.error) || text(entry.reason))
    const success = explicitSuccess || (status === 'fulfilled' && !explicitFailure)
    const rawTo = text(entry.to) || text(nested.to) || text(entry.phone) || phones[index] || null
    const targetByPhone = byPhone(rawTo, phones)
    const phoneIndex = targetByPhone ? phones.indexOf(targetByPhone) : -1
    return {
      target: text(entry.target) || text(nested.target) || recipients[phoneIndex >= 0 ? phoneIndex : index] || null,
      to: rawTo,
      success,
      sid: text(entry.sid) || text(nested.sid) || null,
      error: text(entry.error) || text(nested.error) || text(entry.reason) || null,
      status,
    }
  })
}

export function readLeadAlertRecipients(metadata: unknown): string[] {
  return strings(record(metadata).to_agents)
}

export function readLeadAlertCallback(metadata: unknown): LeadAlertCallback | null {
  const callback = record(record(metadata).form_agent_callback)
  if (!Object.keys(callback).length) return null

  return {
    started: bool(callback.started),
    sid: text(callback.sid) || null,
    to: text(callback.to) || null,
    batchId: text(callback.batchId) || text(callback.batch_id) || null,
    calls: records(callback.calls).map((call) => ({
      agentName: text(call.agentName) || text(call.agent) || null,
      to: text(call.to) || null,
      started: bool(call.started),
      sid: text(call.sid) || null,
      error: text(call.error) || null,
    })),
    error: text(callback.error) || null,
  }
}

export function resolveLeadAlertCallback(
  callback: LeadAlertCallback | null,
  relatedRows: LeadAlertActivityLike[],
): LeadAlertCallbackResolution {
  if (!callback?.batchId) {
    return { claimedBy: null, claimedAt: null, outcome: null, outcomeAt: null, dialStatus: null }
  }

  const ordered = [...relatedRows].sort((left, right) => Date.parse(left.created_at || '') - Date.parse(right.created_at || ''))
  let claimedBy: string | null = null
  let claimedAt: string | null = null
  let outcome: 'connected' | 'missed' | null = null
  let outcomeAt: string | null = null
  let dialStatus: string | null = null

  for (const row of ordered) {
    const meta = record(row.metadata)
    const source = text(meta.source)
    if (source !== 'ppc_form_agent_callback' && source !== 'lead_form_agent_callback') continue
    const rowBatchId = text(meta.batch_id) || text(meta.batchId)
    if (rowBatchId !== callback.batchId) continue

    const rowOutcome = text(meta.outcome)
    if (rowOutcome === 'agent_claimed' && !claimedBy) {
      claimedBy = text(meta.agentName) || null
      claimedAt = row.created_at || null
    }
    if (rowOutcome === 'connected' || rowOutcome === 'missed') {
      outcome = rowOutcome
      outcomeAt = row.created_at || null
      dialStatus = text(meta.dialStatus) || null
    }
  }

  return { claimedBy, claimedAt, outcome, outcomeAt, dialStatus }
}

export function buildLeadAlertSummary(items: LeadAlertSummaryInput[]): LeadAlertSummary {
  return items.reduce<LeadAlertSummary>((summary, item) => {
    const deliverySuccess = item.delivery.filter((delivery) => delivery.success).length
    const deliveryFailed = item.delivery.filter((delivery) => !delivery.success).length
    const channel = alertChannel(item.trigger)
    summary.total += 1
    summary.smsSucceeded += deliverySuccess
    summary.smsFailed += deliveryFailed
    if (item.callback?.started) summary.callbacksStarted += 1
    if (item.callbackResolution.claimedBy) summary.callbacksClaimed += 1
    if (item.callbackResolution.outcome === 'connected') summary.callbacksConnected += 1
    if (item.recipients.length === 0) summary.noRecipients += 1
    if (item.recipients.includes('Ernest')) summary.ernestIncluded += 1
    if (item.recipients.includes('Casey')) summary.caseyIncluded += 1
    if ((item.trafficSource || '').toLowerCase() === 'google_ads' || (item.trigger || '').toLowerCase().includes('google_ads')) summary.googleAds += 1
    if (channel === 'form') summary.formAlerts += 1
    if (channel === 'call') summary.callAlerts += 1
    return summary
  }, {
    total: 0,
    smsSucceeded: 0,
    smsFailed: 0,
    callbacksStarted: 0,
    callbacksClaimed: 0,
    callbacksConnected: 0,
    noRecipients: 0,
    ernestIncluded: 0,
    caseyIncluded: 0,
    googleAds: 0,
    formAlerts: 0,
    callAlerts: 0,
  })
}
