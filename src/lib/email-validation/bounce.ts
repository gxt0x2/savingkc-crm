export function bounceTypeFromPayload(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null
  const bounce = (data as { bounce?: { type?: unknown } }).bounce
  const type = bounce?.type
  return typeof type === 'string' && type.trim() ? type.trim().slice(0, 80) : null
}

/** Resend hard bounces use bounce.type Permanent. Soft and unknown bounces stay off this ledger. */
export function isHardBounce(eventType: string, bounceType: string | null | undefined): boolean {
  if (eventType !== 'email.bounced') return false
  const compact = (bounceType ?? '').replace(/[\s_-]+/g, '').toLowerCase()
  return compact === 'permanent' || compact === 'hard' || compact === 'hardbounce'
}
