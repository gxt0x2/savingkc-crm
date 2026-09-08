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
const INCIDENT_TITLE = 'System failure: Mojo ingestion'

function missingMetadataColumn(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /ari_briefing_events\.metadata|metadata.*column|column.*metadata/i.test(error.message))
}

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
    .eq('title', INCIDENT_TITLE)
    .gte('created_at', since)
    .limit(1)

  if (recentError) throw new Error(`Mojo incident dedupe failed: ${recentError.message}`)
  if ((recent ?? []).length > 0) return { created: false, alerted: false }

  const incidentId = `mojo:${now.toISOString()}`
  const event = {
    event_type: 'system_failure',
    priority: 'critical',
    title: INCIDENT_TITLE,
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
  }

  let { error: insertError } = await supabase.from('ari_briefing_events').insert(event)
  if (missingMetadataColumn(insertError)) {
    const legacyCompatibleEvent = {
      event_type: event.event_type,
      priority: event.priority,
      title: event.title,
      description: event.description,
      read: event.read,
      dismissed: event.dismissed,
    }
    ;({ error: insertError } = await supabase.from('ari_briefing_events').insert(legacyCompatibleEvent))
    console.warn(JSON.stringify({
      level: 'warn',
      message: 'mojo_incident_legacy_schema_fallback',
      incidentId,
    }))
  }

  if (insertError) throw new Error(`Mojo incident insert failed: ${insertError.message}`)

  const alert = await sendMojoIngestionFailureSmsAlert({
    incidentId,
    message: input.message,
    source: input.source,
  })
  return { created: true, alerted: Boolean(alert.result?.success) }
}
