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
  const { createClient } = await import('@/lib/supabase/client')
  const { data } = await createClient()
    .from('lead_activities')
    .select('id, activity_type, description, agent, metadata, created_at')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(50)
  return (data as DialerActivity[] | null) ?? []
}

export async function loadDialerLeadContext(leadId: string) {
  const { createClient } = await import('@/lib/supabase/client')
  const supabase = createClient()
  const [{ data: manifestRow }, activities] = await Promise.all([
    supabase.from('manifests').select('manifest').eq('lead_id', leadId).limit(1).maybeSingle(),
    loadDialerActivities(leadId),
  ])
  return {
    manifest: (manifestRow as { manifest: DialerManifest } | null)?.manifest ?? null,
    activities,
  }
}
