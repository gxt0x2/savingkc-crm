import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { onCommunicationEvent } from '@/lib/manifest-sync'


type CallActivity = {
  id: string
  lead_id: string | null
  agent: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const AGENT_CALLER_IDS: Record<string, string> = {
  ernest: '+18166088588',
  casey: '+18167277667',
}

const CALLER_ID_AGENTS: Record<string, string> = {
  '+18166088588': 'Ernest',
  '+18167277667': 'Casey',
}

function metadataPhone(metadata: Record<string, unknown> | null): string | null {
  if (!metadata) return null
  const value = metadata.to || metadata.from || metadata.phone || metadata.calledNumber
  return typeof value === 'string' && value.trim() ? value : null
}

function metadataString(metadata: Record<string, unknown> | null, keys: string[]): string | null {
  if (!metadata) return null
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'string' && value.trim()) return value
  }
  return null
}

function metadataNumber(metadata: Record<string, unknown> | null, keys: string[]): number | null {
  if (!metadata) return null
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value)
  }
  return null
}

function callerIdForAgent(agent: string | null): string | null {
  if (!agent) return null
  const lower = agent.toLowerCase()
  if (lower.includes('ernest')) return AGENT_CALLER_IDS.ernest
  if (lower.includes('casey')) return AGENT_CALLER_IDS.casey
  return null
}

function agentForCallerId(from: unknown): string | null {
  return typeof from === 'string' ? CALLER_ID_AGENTS[from] || null : null
}

function deriveOutcome(activity: CallActivity): string | null {
  const explicit = metadataString(activity.metadata, ['outcome', 'callStatus', 'dialStatus', 'status'])
  if (explicit) return explicit

  const tag = metadataString(activity.metadata, ['tag', 'source', 'trigger'])?.toLowerCase() || ''
  const description = activity.description?.toLowerCase() || ''

  if (tag.includes('voicemail') || description.includes('voicemail')) return 'voicemail'
  if (tag.includes('no_input') || description.includes('no ivr input')) return 'no_answer'
  if (tag.includes('non_lead') || description.includes('non-seller')) return 'non_seller'
  if (tag.includes('spam')) return 'spam'
  if (description.includes('connected')) return 'connected'
  if (description.includes('missed')) return 'missed'
  if (description.includes('outbound call')) return 'completed'
  if (description.includes('inbound call')) return 'received'

  return null
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const limitParam = Number(searchParams.get('limit') || '10')
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 10

    const { data, error } = await supabase
      .from('lead_activities')
      .select('id, lead_id, agent, description, metadata, created_at')
      .eq('activity_type', 'call')
      .order('created_at', { ascending: false })
      .range(0, limit)

    if (error) {
      console.error('[call-log] recent calls query failed:', error.message)
      return NextResponse.json({ error: 'Failed to load recent calls' }, { status: 500 })
    }

    const rows = (data || []) as CallActivity[]
    const hasMore = rows.length > limit
    const activities = rows.slice(0, limit)
    const leadIds = Array.from(new Set(activities.map((a) => a.lead_id).filter(Boolean))) as string[]
    const leadNames = new Map<string, string>()

    if (leadIds.length > 0) {
      const { data: leads, error: leadsError } = await supabase
        .from('leads')
        .select('id, full_name, phone')
        .in('id', leadIds)

      if (leadsError) {
        console.error('[call-log] lead lookup failed:', leadsError.message)
      } else {
        for (const lead of leads || []) {
          if (lead.id) leadNames.set(lead.id, lead.full_name || lead.phone || 'Unknown')
        }
      }
    }

    const calls = activities.map((activity) => {
      const to = metadataString(activity.metadata, ['to', 'calledNumber'])
      const direction = metadataString(activity.metadata, ['direction'])
      const from = metadataString(activity.metadata, ['from']) ||
        (direction?.includes('outbound') ? callerIdForAgent(activity.agent) : null)
      const outcome = deriveOutcome(activity)

      return {
        id: activity.id,
        lead_id: activity.lead_id,
        lead_name: activity.lead_id ? leadNames.get(activity.lead_id) || null : null,
        agent: activity.agent,
        phone: metadataPhone(activity.metadata),
        from,
        to,
        direction,
        outcome,
        duration: metadataNumber(activity.metadata, ['duration', 'callDuration']),
        created_at: activity.created_at,
        metadata: activity.metadata,
        description: activity.description,
      }
    })

    return NextResponse.json({ calls, hasMore, limit })
  } catch (err) {
    console.error('[call-log] GET error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}


// Log outbound calls from the telephony bar
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { phone, event, duration, agent, from, lead_id, heir_name, heir_relation, prospect_phone_id } = body
    const logAgent = agentForCallerId(from) || agent || 'System'

    if (!phone) {
      return NextResponse.json({ error: 'phone required' }, { status: 400 })
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
        agent: logAgent,
        metadata: {
          direction: 'outbound',
          from,
          to: cleanPhone,
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
        agent: logAgent,
        metadata: {
          direction: 'outbound',
          from,
          to: cleanPhone,
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

    return NextResponse.json({ success: true, leadId })
  } catch (err) {
    console.error('Call log error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
