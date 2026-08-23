export interface DialerManifest {
  owner?: { coOwners?: string[] }
  property?: { vacant?: boolean }
}

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

export async function loadDialerLeadContext(leadId: string) {
  const [leadResponse, activities] = await Promise.all([
    fetch(`/api/leads/${encodeURIComponent(leadId)}`, { cache: 'no-store' }),
    loadDialerActivities(leadId),
  ])
  if (!leadResponse.ok) throw new Error('Dialer seller intelligence is unavailable')
  const lead = await leadResponse.json() as { manifest?: DialerManifest | null }
  return {
    manifest: lead.manifest ?? null,
    activities,
  }
}
