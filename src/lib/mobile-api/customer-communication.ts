/** Mirrors the canonical conversation projection's operational-alert exclusions. */
export function isMobileCustomerActivity(activity: {
  activity_type: string
  description?: string | null
  metadata?: unknown
}): boolean {
  const metadata = activity.metadata && typeof activity.metadata === 'object' && !Array.isArray(activity.metadata)
    ? activity.metadata as Record<string, unknown> : {}
  const direction = String(metadata.direction ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (['outbound_alert', 'internal', 'team_alert'].includes(direction)) return false
  if (['to_agents', 'to_agent_phones', 'queue_contract'].some((key) => Object.hasOwn(metadata, key))) return false
  if (['is_team', 'is_internal', 'internal', 'internal_alert', 'team_alert'].some((key) => String(metadata[key]).toLowerCase() === 'true')) return false
  if (activity.activity_type === 'call' && String(metadata.outcome ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_') === 'agent_claimed') return false
  if (activity.activity_type === 'sms' && !direction
    && !['to_agents', 'to_agent_phones', 'queue_contract', 'is_team', 'is_internal', 'internal', 'internal_alert', 'team_alert'].some((key) => Object.hasOwn(metadata, key))
    && /just texted:\s*["“].+["”]\s*—\s*(open\s+crm|https?:\/\/\S+\/leads\/\S+)\s*$/i.test(activity.description ?? '')) return false
  return true
}
