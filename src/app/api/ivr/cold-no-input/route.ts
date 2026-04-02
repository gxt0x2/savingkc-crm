import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isOptedOut } from '@/lib/sms-opt-out'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'
import { phoneRateLimit } from '@/middleware/rate-limit'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

function sendDelayed(fn: () => Promise<void>, minSec: number, maxSec: number) {
  const delay = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000
  setTimeout(() => fn().catch(e => console.error('Delayed send failed:', e)), delay)
}

/**
 * Cold call callback — caller didn't press 1.
 * Don't ring agents. Auto-text to convert passively and hang up.
 */
export async function POST(req: Request) {
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
    description: `Cold call callback from ${from} — didn't press 1, auto-texting`,
    agent: 'System',
    metadata: { direction: 'inbound', from, calledNumber, tag: 'cold_callback_no_input' }
  })

  // Bump priority if they exist — calling back shows interest
  if (leadId) {
    const currentPriority = existingLead?.priority
    if (!currentPriority || currentPriority === 'normal' || currentPriority === 'low') {
      await supabase.from('leads').update({ priority: 'warm' }).eq('id', leadId)
    }
  }

  // Auto-text (delayed 60-120s, with dedup)
  const optedOut = await isOptedOut(from)
  const { allowed: phoneOk } = phoneRateLimit(from)
  if (!optedOut && phoneOk) {
    const autoText = `Hey! We recently tried reaching you about a property in your area. If you've thought about selling, we'd love to make you a cash offer — no repairs, no fees. Reply YES if you're interested.`
    const isDupe = await isDuplicateSms(from, autoText)
    if (!isDupe) {
      sendDelayed(async () => {
        await twilio.messages.create({ body: autoText, from: calledNumber, to: from })
        await logSmsSend(from, autoText, calledNumber, leadId || undefined)
        if (leadId) {
          await supabase.from('lead_activities').insert({
            lead_id: leadId,
            activity_type: 'sms',
            description: autoText,
            agent: 'System',
            metadata: { direction: 'outbound', to: from, trigger: 'cold_callback_auto_text' }
          })
        }
      }, 60, 120)
    }
  }

  // Hang up — don't waste agent time
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">No problem. We'll send you a quick text with more info. Have a great day.</Say>
  <Hangup />
</Response>`,
    { headers: { 'Content-Type': 'text/xml' } }
  )
}
