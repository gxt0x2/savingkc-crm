import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { isOptedOut } from '@/lib/sms-opt-out'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'
import { phoneRateLimit } from '@/middleware/rate-limit'
import { safeSendSMS } from '@/lib/safe-communications'
import { supabase } from '@/lib/supabase-lazy'
import { formatPhone } from '@/lib/format'

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

function sendDelayed(fn: () => Promise<void>, minSec: number, maxSec: number) {
  const delay = (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000
  setTimeout(() => fn().catch(e => console.error('Delayed send failed:', e)), delay)
}

function phoneLookupVariants(raw: string): string[] {
  const digits = raw.replace(/\D/g, '')
  if (!digits) return []

  const national = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  const variants = new Set<string>()
  if (national.length === 10) {
    variants.add(`+1${national}`)
    variants.add(national)
    variants.add(`(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`)
  }
  if (raw.trim()) variants.add(raw.trim())
  return Array.from(variants)
}

async function resolveLeadContext(explicitLeadId: string, phone: string): Promise<{ id: string | null; name: string | null }> {
  if (explicitLeadId) {
    const { data } = await supabase
      .from('leads')
      .select('id, full_name')
      .eq('id', explicitLeadId)
      .limit(1)
      .maybeSingle()
    if (data?.id) return { id: data.id, name: data.full_name || null }
    return { id: explicitLeadId, name: null }
  }

  for (const variant of phoneLookupVariants(phone)) {
    const { data } = await supabase
      .from('leads')
      .select('id, full_name')
      .eq('phone', variant)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.id) return { id: data.id, name: data.full_name || null }
  }

  return { id: null, name: null }
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const from = url.searchParams.get('from') || ''
    const leadId = url.searchParams.get('leadId') || ''
    const calledNumber = url.searchParams.get('calledNumber') || ''
    const type = url.searchParams.get('type') || 'seller'

    const body = await req.formData()
    const parentCallSid = body.get('CallSid') as string
    const dialStatus = body.get('DialCallStatus') as string
    const dialCallSid = body.get('DialCallSid') as string
    const dialCallDurationRaw = body.get('DialCallDuration') as string
    const dialCallDuration = Number.isFinite(Number(dialCallDurationRaw)) ? Math.max(0, Number(dialCallDurationRaw)) : null

    console.log(`[DIAL-RESULT] type=${type} dialStatus=${dialStatus} from=${from} calledNumber=${calledNumber}`)

    const routing = getAgentRouting(calledNumber)
    const isDirect = type === 'direct'
    const lead = await resolveLeadContext(leadId, from)
    const resolvedLeadId = lead.id
    const callerLabel = lead.name || formatPhone(from) || from

  if (dialStatus === 'completed') {
    // Agent answered — log it, no auto-text needed
    if (resolvedLeadId || isDirect) {
      await supabase.from('lead_activities').insert({
        lead_id: resolvedLeadId,
        activity_type: 'call',
        description: isDirect
          ? `Direct inbound call from ${callerLabel} connected live with ${routing.primary.name}${dialCallDuration != null ? ` — ${dialCallDuration}s` : ''}`
          : `Inbound ${type === 'seller' ? 'seller' : 'caller'} connected live with agent`,
        agent: 'System',
        metadata: { outcome: 'connected', direction: 'inbound', from, calledNumber, callSid: parentCallSid, dialStatus, dialCallSid, dialCallDuration, type }
      })

      // Mark pending callback tasks done for known leads.
      if (resolvedLeadId) {
        const { data: pendingTasks } = await supabase
          .from('lead_activities')
          .select('id, metadata')
          .eq('lead_id', resolvedLeadId)
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
    }
    return new NextResponse('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
  }

  // ── Nobody answered ──

  // For direct calls, alert the agent who owns that number only (no tasks/SMS to caller)
  if (isDirect && from) {
    const missedMsg = `MISSED: Direct call from ${from} to your company line. Going to voicemail.`
    await safeSendSMS({ body: missedMsg, from: TWILIO_PHONE, to: routing.primary.phone })

    await supabase.from('lead_activities').insert({
      lead_id: resolvedLeadId,
      activity_type: 'call',
      description: `Missed direct call from ${callerLabel} to ${routing.primary.name}`,
      agent: 'System',
      metadata: { outcome: 'missed', direction: 'inbound', from, calledNumber, callSid: parentCallSid, dialStatus, dialCallSid, dialCallDuration, type }
    })
  }

  if (resolvedLeadId && !isDirect) {
    // Alert both agents for IVR calls
    const missedMsg = `MISSED: Inbound ${type === 'seller' ? 'seller' : 'caller'} ${from} — nobody answered. Going to voicemail.\n${BASE_URL}/leads/${resolvedLeadId}`
    await Promise.allSettled([
      safeSendSMS({ body: missedMsg, from: TWILIO_PHONE, to: routing.primary.phone }),
      safeSendSMS({ body: missedMsg, from: TWILIO_PHONE, to: routing.secondary.phone }),
    ])

    // Log missed call
    await supabase.from('lead_activities').insert({
      lead_id: resolvedLeadId,
      activity_type: 'call',
      description: `Both agents missed inbound ${type} call from ${from}`,
      agent: 'System',
      metadata: { outcome: 'missed', direction: 'inbound', from, calledNumber, callSid: parentCallSid, dialStatus, dialCallSid, dialCallDuration, type }
    })

    // Urgent callback task
    await supabase.from('lead_activities').insert({
      lead_id: resolvedLeadId,
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
  if (from && resolvedLeadId && !isDirect) {
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
          await logSmsSend(from, autoText, calledNumber || TWILIO_PHONE, resolvedLeadId)
          await supabase.from('lead_activities').insert({
            lead_id: resolvedLeadId,
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
  <Redirect method="POST">${BASE_URL}/api/ivr/voicemail?agent=${encodeURIComponent(vmAgent)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(resolvedLeadId || '')}&amp;calledNumber=${encodeURIComponent(calledNumber)}</Redirect>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  } catch (error) {
    console.error('[IVR/dial-result] Critical error:', error)
    // Emergency fallback: simple voicemail
    const emergencyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Please leave a message after the beep.</Say>
  <Record maxLength="120" playBeep="true"/>
  <Hangup />
</Response>`
    return new NextResponse(emergencyTwiml, { headers: { 'Content-Type': 'text/xml' } })
  }
}
