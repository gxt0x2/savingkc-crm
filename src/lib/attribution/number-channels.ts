import { normalizeTwilioNumber } from '@/lib/twilio-numbers'

/** Channels a Twilio number can be assigned to (G7). Google Ads and cold-call lines are labeled in code. */
export const NUMBER_CHANNELS = ['public_number', 'direct_mail', 'signs', 'dispositions', 'staff_direct', 'referral', 'other'] as const
export type NumberChannel = (typeof NUMBER_CHANNELS)[number]

export const NUMBER_CHANNEL_LABELS: Record<NumberChannel, string> = {
  public_number: 'Public number (website, Google profile, print)',
  direct_mail: 'Direct mail',
  signs: 'Signs',
  dispositions: 'Dispositions (buyers)',
  staff_direct: 'Staff direct line',
  referral: 'Referral',
  other: 'Other',
}

export type NumberChannelRow = { number: string; channel: NumberChannel; campaign: string | null }

export function isNumberChannel(value: unknown): value is NumberChannel {
  return typeof value === 'string' && (NUMBER_CHANNELS as readonly string[]).includes(value)
}

/** Validates an admin edit. Returns null when the input is not acceptable. */
export function parseNumberChannelEdit(body: unknown): { number: string; channel: NumberChannel | null; campaign: string | null; note: string | null } | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  const number = normalizeTwilioNumber(typeof b.number === 'string' ? b.number : null)
  if (!number) return null
  const channel = b.channel === null || b.channel === '' ? null : b.channel
  if (channel !== null && !isNumberChannel(channel)) return null
  const clip = (value: unknown, max: number) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null)
  return { number, channel, campaign: clip(b.campaign, 120), note: clip(b.note, 300) }
}
