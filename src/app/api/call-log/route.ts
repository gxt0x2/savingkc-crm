import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { onCommunicationEvent } from '@/lib/manifest-sync'



// Log outbound calls from the telephony bar
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { phone, event, duration, agent, lead_id, heir_name, heir_relation, prospect_phone_id } = body

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
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
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
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
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
