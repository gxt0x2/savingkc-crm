import { formatPhone, toProperCase } from '@/lib/format'

export type ContactDirection = 'inbound' | 'outbound' | 'unknown'
export type ContactOutcome = 'answered' | 'missed' | 'attempted' | 'sent' | 'received' | 'unknown'

export interface ContactActivityLike {
  lead_id?: string | null
  activity_type?: string | null
  type?: string | null
  description?: string | null
  metadata?: Record<string, unknown> | null
  created_at?: string | null
}

export interface ContactSignal {
  direction: ContactDirection
  outcome: ContactOutcome
  at: string | null
  label: string
}

const PLACEHOLDER_NAME_RE = /^(unknown|unnamed|caller|new call|missed call)(\b|\s|\(|#|\d)/i

function normalized(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

function metadataText(activity: ContactActivityLike, key: string): string {
  const value = activity.metadata?.[key]
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function activityText(activity: ContactActivityLike): string {
  return [
    activity.activity_type,
    activity.type,
    activity.description,
    metadataText(activity, 'direction'),
    metadataText(activity, 'status'),
    metadataText(activity, 'outcome'),
    metadataText(activity, 'source'),
  ].filter(Boolean).join(' ').toLowerCase()
}

export function shouldUsePhoneAsName(name: string | null | undefined): boolean {
  const trimmed = (name || '').trim()
  if (!trimmed) return true
  return PLACEHOLDER_NAME_RE.test(trimmed)
}

export function getDisplayLeadName(name: string | null | undefined, phone: string | null | undefined): string {
  if (shouldUsePhoneAsName(name)) {
    return formatPhone(phone) || 'Unknown'
  }
  return toProperCase(name)
}

export function isGoogleAdsSource(source: string | null | undefined): boolean {
  const value = normalized(source).replace(/[\s_]+/g, '-')
  return (
    value === 'ppc-landing' ||
    value.includes('google-ads') ||
    value.includes('googleads') ||
    value.includes('gclid') ||
    value.includes('paid-search')
  )
}

export function getAvatarLabel(name: string | null | undefined, phone: string | null | undefined, source: string | null | undefined): string {
  if (isGoogleAdsSource(source)) return 'GA'

  if (shouldUsePhoneAsName(name)) {
    const digits = (phone || '').replace(/\D/g, '')
    return digits ? digits.slice(-2) : '?'
  }

  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

export function formatLeadSource(source: string | null | undefined): string {
  if (!source) return '--'
  if (isGoogleAdsSource(source)) return 'Google Ads'

  const value = normalized(source)
  const labels: Record<string, string> = {
    website_form: 'Website Form',
    web_form: 'Website Form',
    inbound_call: 'Inbound Call',
    inbound_text: 'Inbound Text',
    inbound_ivr_no_input: 'Inbound IVR',
    mojo_call: 'Mojo',
    manual: 'Manual',
    crm_manual: 'CRM Manual',
    youtube: 'YouTube',
  }
  return labels[value] || source.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
}

export function getActivityDirection(activity: ContactActivityLike): ContactDirection {
  const direction = metadataText(activity, 'direction')
  if (['outbound', 'sent'].includes(direction)) return 'outbound'
  if (['inbound', 'received'].includes(direction)) return 'inbound'

  const text = activityText(activity)
  if (/\b(outbound|sms_sent|sms_outbound|email_sent|outgoing)\b/.test(text)) return 'outbound'
  if (/\b(inbound|received|sms_received|sms_inbound|missed_call|missed call|incoming)\b/.test(text)) return 'inbound'
  return 'unknown'
}

export function getActivityOutcome(activity: ContactActivityLike): ContactOutcome {
  const direction = getActivityDirection(activity)
  const status = metadataText(activity, 'status') || metadataText(activity, 'outcome')
  const text = activityText(activity)

  if (/\b(no-answer|no answer|busy|failed|canceled|cancelled|missed|voicemail)\b/.test(`${status} ${text}`)) {
    return 'missed'
  }

  if (/\b(answered|completed|connected|spoke_with_owner|contact|live)\b/.test(`${status} ${text}`)) {
    return 'answered'
  }

  if (direction === 'outbound' && /\b(sms|email)\b/.test(text)) return 'sent'
  if (direction === 'inbound' && /\b(sms|email)\b/.test(text)) return 'received'
  if (direction === 'outbound') return 'attempted'
  return 'unknown'
}

export function isOutboundAttempt(activity: ContactActivityLike): boolean {
  if (getActivityDirection(activity) !== 'outbound') return false
  const text = activityText(activity)
  return /\b(call|sms|email|voicemail|outbound_call|sms_sent|sms_outbound|email_sent)\b/.test(text)
}

export function getContactSignal(activity: ContactActivityLike): ContactSignal | null {
  const direction = getActivityDirection(activity)
  if (direction === 'unknown') return null

  const text = activityText(activity)
  if (!/\b(call|sms|email|voicemail|missed_call|sms_received|sms_sent|inbound|outbound)\b/.test(text)) {
    return null
  }

  const outcome = getActivityOutcome(activity)
  const kind = /\b(sms|text)\b/.test(text) ? 'SMS' : /\bemail\b/.test(text) ? 'Email' : 'Call'
  const directionLabel = direction === 'inbound' ? 'Inbound' : 'Outbound'
  const outcomeLabel = outcome === 'unknown'
    ? ''
    : ` - ${outcome.charAt(0).toUpperCase()}${outcome.slice(1)}`

  return {
    direction,
    outcome,
    at: activity.created_at || null,
    label: `${directionLabel} ${kind}${outcomeLabel}`,
  }
}

export function formatDurationBetween(
  startIso: string | null | undefined,
  stopIso: string | null | undefined,
  nowMs = Date.now(),
): string {
  if (!startIso) return '--'
  const start = new Date(startIso).getTime()
  if (Number.isNaN(start)) return '--'

  const stop = stopIso ? new Date(stopIso).getTime() : nowMs
  if (Number.isNaN(stop)) return '--'

  const totalMinutes = Math.max(0, Math.floor((stop - start) / 60_000))
  if (totalMinutes < 1) return '<1m'
  if (totalMinutes < 60) return `${totalMinutes}m`

  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours < 24) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`

  const days = Math.floor(hours / 24)
  const remHours = hours % 24
  if (days < 14) return remHours > 0 ? `${days}d ${remHours}h` : `${days}d`

  const weeks = Math.floor(days / 7)
  const remDays = days % 7
  return remDays > 0 ? `${weeks}w ${remDays}d` : `${weeks}w`
}
