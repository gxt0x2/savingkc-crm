import { formatPhone } from '@/lib/format'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

import { automatedSmsBlockReason } from '@/lib/sms-send-gate'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'
import { phoneRateLimit } from '@/middleware/rate-limit'
import { safeSendSMS } from '@/lib/safe-communications'
import { validateTwilioWebhook } from '@/lib/twilio-validate'

function sendDelayed(fn: () => Promise<void>, minSec: number, maxSec: number) {
  const delay = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000
  setTimeout(() => fn().catch(e => console.error('Delayed send failed:', e)), delay)
}

/**
 * Cold call callback — caller didn't press 1.
 * Don't ring agents. Auto-text to convert passively and hang up.
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

  // Auto-text (delayed 60-120s, with dedup). Recheck suppression inside the
  // delay so a stop that lands after this webhook still cancels the send.
  let autoTextScheduled = false
  const { allowed: phoneOk } = phoneRateLimit(from)
  if (phoneOk) {
    // Caller-facing. Do not add a company name to this cold-callback text.
    const autoText = `Hey! We recently tried reaching you about a property in your area. If you've thought about selling, we'd love to make you a cash offer — no repairs, no fees. Just reply YES if you're interested.`
    const isDupe = await isDuplicateSms(from, autoText)
    if (!isDupe) {
      try {
        const blockReason = await automatedSmsBlockReason({ phone: from, leadId })
        if (blockReason) {
          console.info('[IVR/cold-no-input] cold_callback_auto_text blocked', { reason: blockReason })
        } else {
          autoTextScheduled = true
          sendDelayed(async () => {
            const stillBlocked = await automatedSmsBlockReason({ phone: from, leadId })
            if (stillBlocked) {
              console.info('[IVR/cold-no-input] cold_callback_auto_text blocked', { reason: stillBlocked })
              return
            }
            await safeSendSMS({ body: autoText, from: calledNumber, to: from, senderUse: 'reply' })
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
      } catch (error) {
        console.error('[IVR/cold-no-input] cold_callback_auto_text suppression check failed closed:', error)
      }
    }
  }

  // Hang up — don't waste agent time
  const spoken = autoTextScheduled
    ? "No problem. We'll send you a quick text with more info. Have a great day."
    : 'No problem. Have a great day.'
  return new NextResponse(
    `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${spoken}</Say>
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
