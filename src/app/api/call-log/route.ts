import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { onCommunicationEvent } from '@/lib/manifest-sync'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Log outbound calls from the telephony bar
export async function POST(req: Request) {
  try {
    const { phone, event, duration, agent } = await req.json()

    if (!phone) {
      return NextResponse.json({ error: 'phone required' }, { status: 400 })
    }

    // Match phone to lead
    const cleanPhone = phone.replace(/[^\d+]/g, '')
    const { data: lead } = await supabase
      .from('leads')
      .select('id, full_name')
      .eq('phone', cleanPhone)
      .limit(1)
      .single()

    const leadId = lead?.id || null
    const leadName = lead?.full_name || phone

    if (event === 'started') {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'call',
        description: `Outbound call to ${leadName}`,
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
          to: cleanPhone,
          status: 'initiated',
          source: 'telephony_bar',
        }
      })
    } else if (event === 'ended') {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'call',
        description: `Outbound call to ${leadName} — ${duration || 0}s`,
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
          to: cleanPhone,
          status: 'completed',
          duration: duration || 0,
          source: 'telephony_bar',
        }
      })
    }

    // Auto-advance pipeline on outbound call + sync to manifest
    if (leadId && event === 'started') {
      checkAutoAdvance(leadId, 'outbound_contact').catch(() => {})
      onCommunicationEvent(leadId, { type: 'outbound_call' }).catch(() => {})
    }

    return NextResponse.json({ success: true, leadId })
  } catch (err) {
    console.error('Call log error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
