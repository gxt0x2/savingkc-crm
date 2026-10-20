import { formatPhone } from '@/lib/format'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

import { validateTwilioWebhook } from '@/lib/twilio-validate'

/**
 * Cold call callback — caller didn't press 1.
 * Don't ring agents. Hang up. This route does not send SMS.
 */
export async function POST(req: Request) {
  try {
    if (!(await validateTwilioWebhook(req))) {
      return NextResponse.json({ error: 'Invalid Twilio signature' }, { status: 403 })
    }

    const url = new URL(req.url)
    const from = url.searchParams.get('from') || ''
    const calledNumber = url.searchParams.get('calledNumber') || ''

    if (!from || from.includes('anonymous') || from.includes('blocked')) {
      return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
    }

  // Match to existing lead (they're in CRM from cold call list)
  const { data: existingLead } = await supabase
    .from('leads')
    .select('id, full_name, priority')
    .eq('phone', from)
    .limit(1)
    .single()

  const leadId = existingLead?.id || null

  // Log the callback — no lead creation (if they're not in CRM, they're not from our list)
  await supabase.from('lead_activities').insert({
    lead_id: leadId,
    activity_type: 'call',
    description: `Cold call callback from ${formatPhone(from)} — didn't press 1`,
    agent: 'System',
    metadata: { direction: 'inbound', from, calledNumber, tag: 'cold_callback_no_input' }
  })

  // Bump priority if they exist — calling back shows interest
  if (leadId) {
    const currentPriority = existingLead?.priority
    if (!currentPriority || currentPriority === 'normal' || currentPriority === 'low') {
      const { error: priorityError } = await supabase.from('leads').update({ priority: 'warm' }).eq('id', leadId)
      if (priorityError) throw priorityError
    }
  }

  // Hang up — don't waste agent time, and don't text the caller.
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">No problem. Have a great day.</Say>
  <Hangup />
</Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
  } catch (error) {
    console.error('[IVR/cold-no-input] Critical error:', error)
    // Fallback: just hang up gracefully
    return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
  }
}
