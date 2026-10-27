/**
 * Phone values from env and config sometimes include a trailing newline
 * (TWILIO_PHONE_NUMBER="+18163077835\n"). Trim only.
 * Do not reformat the digits or substitute a different number.
 */
export function trimPhoneConfig(value: string | null | undefined): string {
  if (typeof value !== 'string') return ''
  return value.replace(/\\[rnt]/g, '').trim()
}

export function readPhoneEnv(name: string, fallback = ''): string {
  return trimPhoneConfig(process.env[name]) || trimPhoneConfig(fallback)
}

/** Prefer an explicit phone, then a config fallback. Both are trimmed. */
export function readConfiguredPhone(
  value: string | null | undefined,
  fallback: string | null | undefined = '',
): string {
  return trimPhoneConfig(value) || trimPhoneConfig(fallback)
}
