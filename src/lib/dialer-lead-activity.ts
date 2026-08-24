export interface DialerActivity {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export async function loadDialerActivities(leadId: string): Promise<DialerActivity[]> {
  const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/activities?limit=50`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Dialer activity is unavailable')
  const payload = await response.json() as { activities?: DialerActivity[] }
  return Array.isArray(payload.activities) ? payload.activities : []
}
