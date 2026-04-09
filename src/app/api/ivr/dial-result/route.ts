import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAgentRouting } from '@/lib/agent-routing'
import { isOptedOut } from '@/lib/sms-opt-out'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'
import { phoneRateLimit } from '@/middleware/rate-limit'
import { safeSendSMS } from '@/lib/safe-communications'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

function sendDelayed(fn: () => Promise<void>, minSec: number, maxSec: number) {
  const delay = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000
  setTimeout(() => fn().catch(e => console.error('Delayed send failed:', e)), delay)
}

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const leadId = url.searchParams.get('leadId') || ''
  const calledNumber = url.searchParams.get('calledNumber') || ''
  const type = url.searchParams.get('type') || 'seller'

  const body = await req.formData()
  const dialStatus = body.get('DialCallStatus') as string
  const dialCallSid = body.get('DialCallSid') as string

  console.log(`[DIAL-RESULT] type=${type} dialStatus=${dialStatus} from=${from} calledNumber=${calledNumber}`)

  const routing = getAgentRouting(calledNumber)

  if (dialStatus === 'completed') {
    // Agent answered — log it, no auto-text needed
    if (leadId) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'call',
        description: `Inbound ${type === 'seller' ? 'seller' : 'caller'} connected live with agent`,
        agent: 'System',
        metadata: { outcome: 'connected', direction: 'inbound', dialCallSid, type }
      })

      // Mark pending callback tasks done
      const { data: pendingTasks } = await supabase
        .from('lead_activities')
        .select('id, metadata')
        .eq('lead_id', leadId)
        .eq('activity_type', 'task')

      if (pendingTasks) {
        for (const task of pendingTasks) {
          if (task.metadata?.status === 'pending') {
            await supabase.from('lead_activities')
              .update({ metadata: { ...task.metadata, status: 'completed' } })
              .eq('id', task.id)
          }
        }
      }
    }
    return new NextResponse('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
  }

  // ── Nobody answered ──

  const isDirect = type === 'direct'

  // For direct calls, alert the agent who owns that number only (no tasks/SMS to caller)
  if (isDirect && from) {
    const missedMsg = `MISSED: Direct call from ${from} to your company line. Going to voicemail.`
    await safeSendSMS({ body: missedMsg, from: TWILIO_PHONE, to: routing.primary.phone })
  }

  if (leadId && !isDirect) {
    // Alert both agents for IVR calls
    const missedMsg = `MISSED: Inbound ${type === 'seller' ? 'seller' : 'caller'} ${from} — nobody answered. Going to voicemail.\n${BASE_URL}/leads/${leadId}`
    await Promise.allSettled([
      safeSendSMS({ body: missedMsg, from: TWILIO_PHONE, to: routing.primary.phone }),
      safeSendSMS({ body: missedMsg, from: TWILIO_PHONE, to: routing.secondary.phone }),
    ])

    // Log missed call
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'call',
      description: `Both agents missed inbound ${type} call from ${from}`,
      agent: 'System',
      metadata: { outcome: 'missed', direction: 'inbound', dialStatus, type }
    })

    // Urgent callback task
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'task',
      description: `URGENT: Call back ${from} — both agents missed`,
      agent: 'Ari',
      metadata: {
        task_type: 'callback',
        due_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
        assigned_to: routing.primary.name,
        priority: 'critical',
        status: 'pending',
        seller_phone: from
      }
    })
  }

  // Auto-text ONLY when both agents miss IVR calls (not direct calls)
  if (from && leadId && !isDirect) {
    const optedOut = await isOptedOut(from)
    const { allowed: phoneOk } = phoneRateLimit(from)
    if (!optedOut && phoneOk) {
      const isColdCallback = calledNumber && ['+18163100845','+18162538313','+18164761344','+18164761589','+18166404701','+18165788107','+18166408032','+18166536616'].includes(calledNumber)
      const autoText = isColdCallback
        ? `Hey, sorry we missed you! We recently reached out about a property in your area. If you're thinking about selling, reply YES and we'll give you a call back.`
        : type === 'seller'
          ? `Hi, this is Saving KC Homebuyers. Sorry we missed your call! Are you still looking to sell your property? We'd love to chat — reply YES or call us back anytime.`
          : `Hi, this is Saving KC Homebuyers. Sorry we missed your call! How can we help? Feel free to call back or reply to this text.`
      const isDupe = await isDuplicateSms(from, autoText)
      if (!isDupe) {
        sendDelayed(async () => {
          await safeSendSMS({ body: autoText, from: calledNumber || TWILIO_PHONE, to: from })
          await logSmsSend(from, autoText, calledNumber || TWILIO_PHONE, leadId)
          await supabase.from('lead_activities').insert({
            lead_id: leadId,
            activity_type: 'sms',
            description: autoText,
            agent: 'System',
            metadata: { direction: 'outbound', to: from, trigger: 'missed_call_followup' }
          })
        }, 180, 300) // 3-5 minutes
      }
    }
  }

  // Route caller to voicemail
  const vmAgent = routing.primary.name
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/voicemail?agent=${encodeURIComponent(vmAgent)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}&amp;calledNumber=${encodeURIComponent(calledNumber)}</Redirect>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
