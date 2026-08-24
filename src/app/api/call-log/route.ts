import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { resolveCallLogContext, CallLogContextError } from '@/lib/server/call-log-context'
import { buildCallLogCommand } from '@/lib/server/call-log-command'
import { insertCallLogEvidenceOnce } from '@/lib/server/call-log-evidence'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

type CallActivityRow = {
  id: string
  lead_id: string | null
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

// Log outbound calls from the telephony bar
export async function POST(req: Request) {
  try {
    const actor = await resolveAuthenticatedActor()
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
    const parsed = buildCallLogCommand(await req.json())
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: NO_STORE_HEADERS })
    const command = parsed.command
    const context = await resolveCallLogContext({
      phone: command.phone,
      leadId: command.leadId,
      prospectPhoneId: command.prospectPhoneId,
    })
    const profile = resolveAgentTelephonyProfile(actor.email)
    const finalDuration = command.durationSeconds
    const finalStatus = normalizeOutboundFinalStatus(
      command.status,
      command.outcome,
      command.disposition,
    )
    const finalOutcome = normalizeOutboundOutcome(finalStatus, command.outcome)
    const finalDisposition = normalizeOutboundDisposition(finalStatus, command.disposition)

    // When dialing a relative, the activity row reads "Call to <heir> (daughter)"
    // so the property timeline is legible. Without heir context we keep the
    // original "Outbound call to <lead>" wording.
    const isHeirCall = Boolean(context.heir)
    const heirLabel = context.heir ? `${context.heir.name || 'heir'} (${context.heir.relationship || 'relative'})` : null
    const source = isHeirCall ? 'heir_dialer' : 'telephony_bar'
    const action = command.event === 'started' ? 'call_started' : 'call_ended'
    if (command.event === 'started') {
      await insertCallLogEvidenceOnce({
        leadId: context.leadId,
        source,
        event: action,
        clientAttemptId: command.clientAttemptId,
        payload: {
          lead_id: context.leadId,
          activity_type: 'call',
          description: isHeirCall ? `Outbound call to ${heirLabel}` : `Outbound call to ${context.leadName}`,
          agent: actor.name,
          metadata: {
            direction: 'outbound',
            to: command.phone,
            from: command.fromNumber,
            agent_identity: profile.identity,
            status: 'initiated',
            source,
            action,
            client_attempt_id: command.clientAttemptId,
            is_internal: true,
            ...(context.heir && {
              heir_name: context.heir.name,
              heir_relation: context.heir.relationship,
              prospect_phone_id: context.heir.prospectPhoneId,
              prospect_owner_name: context.heir.ownerName,
            }),
          },
        },
      })
    } else {
      await insertCallLogEvidenceOnce({
        leadId: context.leadId,
        source,
        event: action,
        clientAttemptId: command.clientAttemptId,
        payload: {
          lead_id: context.leadId,
          activity_type: 'call',
          description: isHeirCall
            ? `Outbound call to ${heirLabel} — ${outboundResultLabel(finalStatus, finalDuration)}`
            : `Outbound call to ${context.leadName} — ${outboundResultLabel(finalStatus, finalDuration)}`,
          agent: actor.name,
          metadata: {
            direction: 'outbound',
            to: command.phone,
            from: command.fromNumber,
            agent_identity: profile.identity,
            status: finalStatus,
            outcome: finalOutcome,
            disposition: finalDisposition,
            duration: finalDuration,
            source,
            action,
            client_attempt_id: command.clientAttemptId,
            is_internal: true,
            ...(context.heir && {
              heir_name: context.heir.name,
              heir_relation: context.heir.relationship,
              prospect_phone_id: context.heir.prospectPhoneId,
              prospect_owner_name: context.heir.ownerName,
            }),
          },
        },
      })
    }

    // On call end: refresh denormalized last-call snapshot on the lead row
    if (context.leadId && command.event === 'ended') {
      if (isConnectedOutbound(finalStatus, finalOutcome, finalDisposition)) {
        checkAutoAdvance(context.leadId, 'outbound_contact').catch(err => console.error('[AUTO-ADVANCE] Failed:', err))
      }

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (isConnectedOutbound(finalStatus, finalOutcome, finalDisposition) && finalDuration > 0) {
        patch.call_duration_seconds = finalDuration
      }
      await supabase.from('leads').update(patch).eq('id', context.leadId).then(({ error }) => {
        if (error) console.error('[call-log] lead snapshot update failed:', error.message)
      })
    }

    return NextResponse.json({ success: true, leadId: context.leadId }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    if (err instanceof CallLogContextError) {
      return NextResponse.json({ error: err.message }, { status: err.status, headers: NO_STORE_HEADERS })
    }
    console.error('Call log error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function GET(req: Request) {
  try {
    const actor = await resolveAuthenticatedActor()
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
    const { searchParams } = new URL(req.url)
    const limitParam = Number(searchParams.get('limit') || '10')
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 10

    // Every outbound call writes TWO rows: status=initiated on start +
    // status=completed on end. Recent Calls is a UI surface — show one row
    // per call. Exclude the initiated row; it stays in the DB for audit.
    const { data, error } = await supabase
      .from('lead_activities')
      .select('id, lead_id, description, agent, metadata, created_at')
      .eq('activity_type', 'call')
      .neq('metadata->>status', 'initiated')
      .order('created_at', { ascending: false })
      .limit(limit * 3)

    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })

    const leadIds = Array.from(
      new Set(
        (data || [])
          .map((row: CallActivityRow) => (typeof row.lead_id === 'string' ? row.lead_id : null))
          .filter((id: string | null): id is string => Boolean(id))
      )
    )

    const leadNameById: Record<string, string> = {}
    if (leadIds.length > 0) {
      const { data: leadRows } = await supabase
        .from('leads')
        .select('id, full_name')
        .in('id', leadIds)
      for (const lead of leadRows || []) {
        if (typeof lead.id === 'string' && typeof lead.full_name === 'string' && lead.full_name.trim()) {
          leadNameById[lead.id] = lead.full_name.trim()
        }
      }
    }

    const calls = (data || [])
      .map((row: CallActivityRow) => {
        const raw = (row.metadata && typeof row.metadata === 'object')
          ? (row.metadata as Record<string, unknown>)
          : {}
        const description = typeof row.description === 'string' ? row.description : ''
        const direction = normalizeDirection(raw, description)
        const disposition = normalizeDisposition(raw, description)
        const outcome = normalizeOutcome(raw, description)
        const status = normalizeStatus(raw, description)
        const duration = normalizeDuration(raw, description)
        const from = readString(raw.from)
        const to = readString(raw.to) || readString(raw.phone)
        const phone = direction === 'inbound'
          ? from || to || parsePhone(description)
          : to || from || parsePhone(description)
        const inferredLeadName = inferLeadName(description, raw)
        const leadName = inferredLeadName || (typeof row.lead_id === 'string' ? leadNameById[row.lead_id] || null : null)
        const metadata = {
          ...raw,
          direction: direction || undefined,
          disposition: disposition || undefined,
          outcome: outcome || undefined,
          status: status || undefined,
          duration: typeof duration === 'number' ? duration : undefined,
          from: from || undefined,
          to: to || undefined,
        }
        return {
          id: row.id,
          lead_id: row.lead_id,
          lead_name: leadName || null,
          phone: phone || null,
          created_at: row.created_at,
          agent: row.agent || null,
          metadata,
        }
      })
      .slice(0, limit)

    return NextResponse.json({ calls }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    console.error('Call log list error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function normalizeOutboundFinalStatus(
  status: string | null,
  outcome: string | null,
  disposition: string | null
): string {
  const normalizedStatus = status?.trim().toLowerCase().replace(/_/g, '-')
  if (normalizedStatus) {
    if (normalizedStatus === 'answered' || normalizedStatus === 'connected') return 'completed'
    if (normalizedStatus === 'missed') return 'no-answer'
    return normalizedStatus
  }

  const normalizedOutcome = outcome?.trim().toLowerCase().replace(/_/g, '-')
  if (normalizedOutcome === 'missed') return 'no-answer'
  if (normalizedOutcome === 'connected') return 'completed'

  const normalizedDisposition = disposition?.trim().toLowerCase().replace(/_/g, '-')
  if (normalizedDisposition === 'no-answer' || normalizedDisposition === 'busy') return normalizedDisposition
  if (normalizedDisposition === 'answered') return 'completed'

  return 'completed'
}

function normalizeOutboundOutcome(status: string, outcome: string | null): string {
  const normalizedOutcome = outcome?.trim().toLowerCase().replace(/_/g, '-')
  if (normalizedOutcome) return normalizedOutcome
  return status === 'completed' ? 'connected' : 'missed'
}

function normalizeOutboundDisposition(status: string, disposition: string | null): string {
  const normalizedDisposition = disposition?.trim().toLowerCase().replace(/-/g, '_')
  if (normalizedDisposition) return normalizedDisposition
  if (status === 'completed') return 'answered'
  if (status === 'busy') return 'busy'
  return 'no_answer'
}

function isConnectedOutbound(status: string, outcome: string, disposition: string): boolean {
  return status === 'completed' || outcome === 'connected' || disposition === 'answered'
}

function outboundResultLabel(status: string, duration: number): string {
  if (status === 'completed') return `${duration}s`
  if (status === 'busy') return 'busy'
  if (status === 'failed') return 'failed'
  if (status === 'canceled' || status === 'cancelled') return 'canceled'
  if (status === 'no-answer') return 'no answer'
  return status || `${duration}s`
}

function parsePhone(text: string): string | null {
  const match = text.match(/(\+?\d[\d\s()-]{6,}\d)/)
  if (!match) return null
  return match[1].replace(/\s+/g, '')
}

function normalizeDirection(metadata: Record<string, unknown>, description: string): 'inbound' | 'outbound' | null {
  const direct = readString(metadata.direction)
  if (direct === 'inbound' || direct === 'outbound') return direct
  if (/^outbound\b/i.test(description)) return 'outbound'
  if (/^inbound\b/i.test(description) || /^cold call callback\b/i.test(description) || /missed inbound/i.test(description)) return 'inbound'
  return null
}

function normalizeDisposition(metadata: Record<string, unknown>, description: string): string | null {
  const disposition = readString(metadata.disposition)
  if (disposition) return disposition
  const callStatus = readString(metadata.callStatus)
  if (callStatus === 'no-answer' || callStatus === 'busy') return 'no_answer'
  const dialStatus = readString(metadata.dialStatus)
  if (dialStatus === 'no-answer' || dialStatus === 'busy') return 'no_answer'
  if (/call:\s*no answer/i.test(description)) return 'no_answer'
  return null
}

function normalizeOutcome(metadata: Record<string, unknown>, description: string): string | null {
  const outcome = readString(metadata.outcome)
  if (outcome) return outcome
  const callStatus = readString(metadata.callStatus)
  if (callStatus === 'no-answer' || callStatus === 'busy') return 'missed'
  const dialStatus = readString(metadata.dialStatus)
  if (dialStatus === 'no-answer' || dialStatus === 'busy') return 'missed'
  if (/missed inbound|no answer/i.test(description)) return 'missed'
  return null
}

function normalizeStatus(metadata: Record<string, unknown>, description: string): string | null {
  const status = readString(metadata.status)
  if (status) return status
  const callStatus = readString(metadata.callStatus)
  if (callStatus) return callStatus
  const dialStatus = readString(metadata.dialStatus)
  if (dialStatus) return dialStatus
  const event = readString(metadata.event)
  if (event === 'started') return 'initiated'
  if (event === 'ended') return 'completed'
  if (/\s[—-]\s\d+s$/i.test(description) || /\(\d+s\)$/i.test(description)) return 'completed'
  if (/^call:\s/i.test(description)) return 'disposition_logged'
  return null
}

function normalizeDuration(metadata: Record<string, unknown>, description: string): number | null {
  const duration = readNumber(metadata.duration)
  if (duration != null) return Math.max(0, Math.round(duration))
  const match = description.match(/(?:[—-]\s*|\()(\d+)s\)?$/i)
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) ? parsed : null
}

function inferLeadName(description: string, metadata: Record<string, unknown>): string | null {
  const heirName = readString(metadata.heir_name)
  if (heirName) return heirName

  const outbound = description.match(/^Outbound call to\s+(.+?)(?:\s+[—-]\s+\d+s)?$/i)
  if (outbound?.[1]) return outbound[1].trim()

  const inbound = description.match(/^Inbound(?:\s+seller|\s+call|\s+.*)?\s+from\s+(.+?)(?:\s+—.*)?$/i)
  if (inbound?.[1]) return inbound[1].trim()

  const coldCallback = description.match(/^Cold call callback from\s+(.+?)(?:\s+—.*)?$/i)
  if (coldCallback?.[1]) return coldCallback[1].trim()

  const missed = description.match(/missed inbound .* call from\s+(.+)$/i)
  if (missed?.[1]) return missed[1].trim()

  return null
}
