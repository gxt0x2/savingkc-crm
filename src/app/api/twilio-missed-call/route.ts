import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { isOptedOut } from '@/lib/sms-opt-out'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { rateLimit, rateLimitConfigs, getClientIp, phoneRateLimit } from '@/middleware/rate-limit'
import { onCommunicationEvent, ensureManifestExists } from '@/lib/manifest-sync'
import { sendPushToAgents } from '@/lib/push-notifications'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const twilio = require('twilio')(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
)

const ERNEST_PHONE = process.env.ERNEST_PHONE || '+18162262552'
const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

// Random delay to make auto-texts feel human (not instant/robotic)
function randomDelay(minSec: number, maxSec: number): number {
  return (Math.floor(Math.random() * (maxSec - minSec + 1)) + minSec) * 1000
}

function sendDelayed(fn: () => Promise<void>, minSec: number, maxSec: number) {
  const delay = randomDelay(minSec, maxSec)
  setTimeout(() => fn().catch(e => console.error('Delayed send failed:', e)), delay)
}

// Internal team numbers — never trigger lead flows for these
const TEAM_NUMBERS = new Set([
  '+18167564943', // Casey personal
  '+18167277667', // Casey company
  '+18166088588', // Ernest company
  '+18162262552', // Ernest personal
])

/**
 * StatusCallback handler — fires for ALL call status events
 * Logs every inbound call to the CRM, handles missed call flow
 */
export async function POST(req: Request) {
  try {
    // Twilio signature validation
    const isValid = await validateTwilioWebhook(req)
    if (!isValid) {
      return new NextResponse('Forbidden', { status: 403 })
    }

    // IP-based rate limiting
    const ip = getClientIp(req)
    const { allowed: ipAllowed } = rateLimit(ip, rateLimitConfigs.webhook)
    if (!ipAllowed) {
      return new NextResponse('Rate limited', { status: 429 })
    }

    const body = await req.formData()
    const from = body.get('From') as string
    const to = body.get('To') as string
    const callStatus = body.get('CallStatus') as string
    const callSid = body.get('CallSid') as string
    const duration = body.get('CallDuration') as string || '0'
    const direction = body.get('Direction') as string || 'inbound'

    if (!from) {
      return new NextResponse('OK', { status: 200 })
    }

    // Skip all lead/auto-text flows for internal team numbers
    if (TEAM_NUMBERS.has(from)) {
      return new NextResponse('OK', { status: 200 })
    }

    // Match caller to existing lead
    const { data: leads } = await supabase
      .from('leads')
      .select('id, full_name, phone')
      .eq('phone', from)
      .limit(1)

    const leadId = leads && leads.length > 0 ? leads[0].id : null
    const leadName = leads && leads.length > 0 ? leads[0].full_name : null

    // Log EVERY inbound call to lead_activities
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'call',
      description: `Inbound call from ${leadName || from} — ${callStatus} (${duration}s)`,
      agent: 'System',
      metadata: {
        direction: 'inbound',
        from,
        to,
        callSid,
        callStatus,
        duration: parseInt(duration),
        matched_lead: leadId ? true : false,
        lead_name: leadName,
      }
    })

    // Ari briefing event for all inbound calls
    if (leadId) {
      await supabase.from('ari_briefing_events').insert({
        event_type: 'inbound_call',
        priority: callStatus === 'completed' ? 'medium' : 'high',
        title: `Inbound call from ${leadName || from} — ${callStatus}`,
        description: `Duration: ${duration}s. Status: ${callStatus}.`,
        lead_id: leadId,
        action_url: `/leads/${leadId}`
      })

      // Sync to manifest (stale briefing + motivation signal)
      const eventType = (callStatus === 'no-answer' || callStatus === 'busy') ? 'missed_call' : 'inbound_call'
      onCommunicationEvent(leadId, { type: eventType as any }).catch(err => console.error('[MANIFEST] Failed:', err))
    }

    // Missed call specific handling (no-answer or busy)
    if (callStatus === 'no-answer' || callStatus === 'busy') {
      if (leadId && leadName) {
        // Known lead — bump priority, send text-back, create callback
        await supabase.from('leads')
          .update({ priority: 'hot' })
          .eq('id', leadId)

        const firstName = leadName.split(' ')[0] || 'there'
        const smsBody = `Hey ${firstName}, this is Ernest with Saving KC — I just missed your call. I'm available now if you'd like to try again, or I can call you back at a better time.`

        // Opt-out + rate limit check before auto-text (delayed 45-90s to feel natural)
        const optedOut = await isOptedOut(from)
        const { allowed: phoneAllowed } = phoneRateLimit(from)
        const replyFrom = to || TWILIO_PHONE // Reply from the number they called
        if (!optedOut && phoneAllowed) {
          sendDelayed(async () => {
            await twilio.messages.create({ body: smsBody, from: replyFrom, to: from })
            await supabase.from('lead_activities').insert({
              lead_id: leadId,
              activity_type: 'sms',
              description: smsBody,
              agent: 'System',
              metadata: { direction: 'outbound', from: replyFrom, to: from, trigger: 'missed_call_auto' }
            })
          }, 45, 90)
        }

        // Alert both agents about known lead missed call
        const missedAlert = `🔥 Missed call from ${leadName} (hot lead). Auto-text sent. Callback in 5 min. ${(process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com')}/leads/${leadId}`
        await Promise.allSettled([
          twilio.messages.create({ body: missedAlert, from: TWILIO_PHONE, to: CASEY_PHONE }),
          twilio.messages.create({ body: missedAlert, from: TWILIO_PHONE, to: ERNEST_PHONE }),
        ])
        sendPushToAgents({
          title: 'Missed Call - Hot Lead',
          body: `${leadName} called and got no answer. Auto-text sent.`,
          url: `/leads/${leadId}`,
          tag: 'missed-call',
        }).catch(() => {})

        // 5-min callback task
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'task',
          description: `Callback: Missed call from ${leadName}`,
          agent: 'System',
          metadata: {
            task_type: 'callback',
            due_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            assigned_to: 'Casey',
            priority: 'critical',
            status: 'pending',
          }
        })
      } else if (!leadId) {
        // Unknown caller missed call — check prospects first
        let newLeadId: string | null = null

        const { lookupProspectByPhone } = await import('@/lib/prospect-lookup')
        const { createEnrichedLeadFromProspect } = await import('@/lib/prospect-to-lead')

        const prospectMatches = await lookupProspectByPhone(from)
        if (prospectMatches.length > 0) {
          newLeadId = await createEnrichedLeadFromProspect(
            prospectMatches[0],
            from,
            'inbound_call',
            'hot'
          )
        }

        // If no prospect match, create bare lead
        if (!newLeadId) {
          const { data: newLead } = await supabase.from('leads').insert({
            full_name: `Missed Call (${from})`,
            phone: from,
            source: 'inbound_call',
            station: 'intake',
            priority: 'hot',
          }).select('id').single()
          newLeadId = newLead?.id || null
        }

        // Re-link the already-logged call activity to the new lead
        if (newLeadId) {
          await supabase.from('lead_activities')
            .update({ lead_id: newLeadId })
            .eq('metadata->>callSid', callSid)
            .is('lead_id', null)

          // Auto-create manifest + sync missed call signal
          ensureManifestExists(newLeadId).then(() => {
            onCommunicationEvent(newLeadId, { type: 'missed_call' }).catch(err => console.error('[MANIFEST] Failed:', err))
          }).catch(err => console.error('[MANIFEST] Failed:', err))
        }

        const unknownSmsBody = `Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back.`
        const unknownReplyFrom = to || TWILIO_PHONE
        const unknownOptedOut = await isOptedOut(from)
        const { allowed: unknownPhoneAllowed } = phoneRateLimit(from)
        if (!unknownOptedOut && unknownPhoneAllowed) {
          // Delayed 60-120s so it doesn't feel robotic
          sendDelayed(async () => {
            await twilio.messages.create({ body: unknownSmsBody, from: unknownReplyFrom, to: from })
            await supabase.from('lead_activities').insert({
              lead_id: newLeadId,
              activity_type: 'sms',
              description: unknownSmsBody,
              agent: 'System',
              metadata: { direction: 'outbound', from: unknownReplyFrom, to: from, trigger: 'missed_call_unknown' }
            })
          }, 60, 120)
        }

        // Alert both agents about unknown caller
        const agentAlert = `📞 Missed call from unknown number ${from}. Auto-text sent. Watch for YES reply.${newLeadId ? ' ' + (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com') + '/leads/' + newLeadId : ''}`
        await Promise.allSettled([
          twilio.messages.create({ body: agentAlert, from: TWILIO_PHONE, to: CASEY_PHONE }),
          twilio.messages.create({ body: agentAlert, from: TWILIO_PHONE, to: ERNEST_PHONE }),
        ])
        sendPushToAgents({
          title: 'Missed Call - Unknown',
          body: `Unknown number ${from} called. Auto-text sent.`,
          url: newLeadId ? `/leads/${newLeadId}` : '/',
          tag: 'missed-call-unknown',
        }).catch(() => {})

        // Briefing event for unknown missed call (now with lead_id)
        try {
          await supabase.from('ari_briefing_events').insert({
            event_type: 'missed_call',
            priority: 'high',
            title: `Missed call from unknown: ${from}`,
            description: `Unknown caller, auto-text sent. Watch for YES reply.`,
            lead_id: newLeadId,
            action_url: newLeadId ? `/leads/${newLeadId}` : undefined,
          })
        } catch {}
      }
    }

    return new NextResponse('OK', { status: 200 })
  } catch (err) {
    console.error('Status callback error:', err)
    return new NextResponse('Error', { status: 500 })
  }
}
