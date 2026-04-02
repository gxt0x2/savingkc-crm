import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  try {
    const { data: activities } = await supabase
      .from('lead_activities')
      .select('type')
      .gte('created_at', todayStart.toISOString())

    const counts = { calls: 0, sms_sent: 0, sms_received: 0, voicemails: 0 }

    for (const a of activities || []) {
      if (a.type === 'call' || a.type === 'outbound_call') counts.calls++
      else if (a.type === 'sms_sent' || a.type === 'sms_outbound') counts.sms_sent++
      else if (a.type === 'sms_received' || a.type === 'sms_inbound') counts.sms_received++
      else if (a.type === 'voicemail') counts.voicemails++
    }

    return NextResponse.json(counts)
  } catch {
    return NextResponse.json({ calls: 0, sms_sent: 0, sms_received: 0, voicemails: 0 })
  }
}
