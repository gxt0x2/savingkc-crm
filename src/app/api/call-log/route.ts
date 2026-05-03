import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { onCommunicationEvent } from '@/lib/manifest-sync'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}


// Log outbound calls from the telephony bar
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { phone, event, duration, agent, lead_id, heir_name, heir_relation, prospect_phone_id, agent_identity, from_number } = body

    if (!phone) {
      return NextResponse.json({ error: 'phone required' }, { status: 400, headers: NO_STORE_HEADERS })
    }

    const cleanPhone = phone.replace(/[^\d+]/g, '')

    // Prefer an explicit lead_id from the caller (set by the dialer for queue
    // mode so heir calls are attributed to the property lead, not the heir).
    let leadId: string | null = lead_id ?? null
    let leadName: string = phone

    if (leadId) {
      const { data: leadRow } = await supabase
        .from('leads').select('full_name').eq('id', leadId).limit(1).single()
      leadName = leadRow?.full_name || phone
    } else {
      const { data: lead } = await supabase
        .from('leads').select('id, full_name').eq('phone', cleanPhone).limit(1).single()
      leadId = lead?.id || null
      leadName = lead?.full_name || phone
    }

    // When dialing a relative, the activity row reads "Call to <heir> (daughter)"
    // so the property timeline is legible. Without heir context we keep the
    // original "Outbound call to <lead>" wording.
    const isHeirCall = Boolean(heir_name)
    const heirLabel = isHeirCall ? `${heir_name} (${heir_relation || 'relative'})` : null

    if (event === 'started') {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'call',
        description: isHeirCall ? `Outbound call to ${heirLabel}` : `Outbound call to ${leadName}`,
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
          to: cleanPhone,
          from: from_number || null,
          agent_identity: agent_identity || null,
          status: 'initiated',
          source: isHeirCall ? 'heir_dialer' : 'telephony_bar',
          ...(isHeirCall && { heir_name, heir_relation, prospect_phone_id }),
        }
      })
    } else if (event === 'ended') {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'call',
        description: isHeirCall
          ? `Outbound call to ${heirLabel} — ${duration || 0}s`
          : `Outbound call to ${leadName} — ${duration || 0}s`,
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
          to: cleanPhone,
          from: from_number || null,
          agent_identity: agent_identity || null,
          status: 'completed',
          duration: duration || 0,
          source: isHeirCall ? 'heir_dialer' : 'telephony_bar',
          ...(isHeirCall && { heir_name, heir_relation, prospect_phone_id }),
        }
      })
    }

    // Auto-advance pipeline on outbound call + sync to manifest
    if (leadId && event === 'started') {
      checkAutoAdvance(leadId, 'outbound_contact').catch(err => console.error('[AUTO-ADVANCE] Failed:', err))
      onCommunicationEvent(leadId, { type: 'outbound_call' }).catch(err => console.error('[MANIFEST-SYNC] Failed:', err))
    }

    // On call end: refresh denormalized last-call snapshot on the lead row
    if (leadId && event === 'ended') {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (typeof duration === 'number' && duration > 0) patch.call_duration_seconds = duration
      await supabase.from('leads').update(patch).eq('id', leadId).then(({ error }) => {
        if (error) console.error('[call-log] lead snapshot update failed:', error.message)
      })
    }

    return NextResponse.json({ success: true, leadId }, { headers: NO_STORE_HEADERS })
  } catch (err) {
    console.error('Call log error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limitParam = Number(searchParams.get('limit') || '10')
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 10

    const { data, error } = await supabase
      .from('lead_activities')
      .select('id, lead_id, description, agent, metadata, created_at')
      .eq('activity_type', 'call')
      .order('created_at', { ascending: false })
      .limit(limit * 3)

    if (error) return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })

    const leadIds = Array.from(
      new Set(
        (data || [])
          .map((row: any) => (typeof row.lead_id === 'string' ? row.lead_id : null))
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
      .map((row: any) => {
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
