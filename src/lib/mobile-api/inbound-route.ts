import { isColdCallCallbackNumber } from '@/lib/twilio-numbers'

export type MobileInboundRoute = 'cold_callback'

function text(metadata: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

/**
 * Classification is response-only: it preserves the call record while giving
 * clients a stable way to suppress cold-callback alerts. Exact legacy markers
 * are accepted only where the old callback routes wrote them.
 */
export function mobileInboundRoute(metadata: Record<string, unknown>, description?: string | null): MobileInboundRoute | null {
  if (isColdCallCallbackNumber(text(metadata, 'calledNumber', 'called_number', 'to', 'to_number'))) return 'cold_callback'
  if (text(metadata, 'source') === 'cold_callback_press_1') return 'cold_callback'
  if (text(metadata, 'tag') === 'cold_callback_no_input') return 'cold_callback'
  if (/^cold call callback\b/i.test(description?.trim() || '')) return 'cold_callback'
  return null
}
