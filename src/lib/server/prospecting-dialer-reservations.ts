import { supabase } from '@/lib/supabase-lazy'

// Call only after campaign access and active dialer status have been checked.
// Session expiry locks and rechecks the row in Postgres, preserves connected
// calls/pending outcomes, and releases unworked members through the existing
// batch-release trigger. Never clear reservations directly from the server.
export async function expireIdleCampaignDialerSessions(campaignId: string) {
  const { data, error } = await supabase
    .from('dialer_sessions')
    .select('id,actor_email')
    .eq('prospecting_campaign_id', campaignId)
    .in('status', ['active', 'paused'])
    .order('last_interaction_at', { ascending: true })
    .limit(100)
  if (error) return error

  for (const session of data || []) {
    const { error: expirationError } = await supabase.rpc('expire_dialer_session_if_idle_v1', {
      p_session_id: session.id,
      p_actor_email: session.actor_email,
    })
    if (expirationError) return expirationError
  }
  return null
}

export async function campaignDialerQueueIsReserved(campaignId: string): Promise<boolean> {
  try {
    const counts = await Promise.all([
      supabase.from('prospecting_campaign_members').select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId).eq('status', 'active').is('dialer_session_id', null),
      supabase.from('prospecting_campaign_members').select('id', { count: 'exact', head: true })
        .eq('campaign_id', campaignId).eq('status', 'active').not('dialer_session_id', 'is', null),
    ])
    return counts.every((result) => !result.error)
      && counts[0].count === 0 && (counts[1].count || 0) > 0
  } catch {
    // Diagnostic failure must not replace the original launch error.
    return false
  }
}
