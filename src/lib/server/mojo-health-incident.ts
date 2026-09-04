import 'server-only'

import type { supabaseAdmin } from '@/lib/supabase/admin'
import { sendMojoIngestionFailureSmsAlert } from '@/lib/server/operational-sms-alerts'

type SupabaseLike = Pick<ReturnType<typeof supabaseAdmin>, 'from'>

export type MojoIncidentInput = {
  message: string
  reason: string
  source: string
  sessionStatus?: string | null
  syncHealth?: string | null
  lastSyncAt?: string | null
}

export type MojoIncidentResult = {
  created: boolean
  alerted: boolean
}

const DEDUPE_WINDOW_MS = 6 * 60 * 60 * 1000

export async function recordMojoHealthIncident(
  supabase: SupabaseLike,
  input: MojoIncidentInput,
  now = new Date(),
): Promise<MojoIncidentResult> {
  const since = new Date(now.getTime() - DEDUPE_WINDOW_MS).toISOString()
  const { data: recent, error: recentError } = await supabase
    .from('ari_briefing_events')
    .select('id')
    .eq('event_type', 'system_failure')
    .contains('metadata', { system: 'mojo_ingestion' })
    .gte('created_at', since)
    .limit(1)

  if (recentError) throw new Error(`Mojo incident dedupe failed: ${recentError.message}`)
  if ((recent ?? []).length > 0) return { created: false, alerted: false }

  const incidentId = `mojo:${now.toISOString()}`
  const { error: insertError } = await supabase.from('ari_briefing_events').insert({
    event_type: 'system_failure',
    priority: 'critical',
    title: 'System failure: Mojo ingestion',
    description: input.message,
    metadata: {
      system: 'mojo_ingestion',
      incident_id: incidentId,
      reason: input.reason,
      source: input.source,
      session_status: input.sessionStatus ?? null,
      sync_health: input.syncHealth ?? null,
      last_sync_at: input.lastSyncAt ?? null,
      manual_refresh_command: 'npm run mojo:refresh',
    },
    read: false,
    dismissed: false,
  })

  if (insertError) throw new Error(`Mojo incident insert failed: ${insertError.message}`)

  const alert = await sendMojoIngestionFailureSmsAlert({
    incidentId,
    message: input.message,
    source: input.source,
  })
  return { created: true, alerted: Boolean(alert.result?.success) }
}
