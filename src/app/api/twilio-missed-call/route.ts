import { NextResponse } from 'next/server'
import { isOptedOut } from '@/lib/sms-opt-out'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { rateLimit, rateLimitConfigs, getClientIp, phoneRateLimit } from '@/middleware/rate-limit'
import { onCommunicationEvent, ensureManifestExists } from '@/lib/manifest-sync'
import { safeSendSMS } from '@/lib/safe-communications'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { formatPhone } from '@/lib/format'
import { supabase } from '@/lib/supabase-lazy'

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
  '+18162262552', // Ernest forwarding
])

const DIRECT_RING_NUMBERS = new Set([
  '+18167277667', // Casey company
  '+18166088588', // Ernest company
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
    const fromRaw = body.get('From') as string | null
    const to = body.get('To') as string | null
    const callStatus = body.get('CallStatus') as string
    const callSid = body.get('CallSid') as string
    const duration = body.get('CallDuration') as string || '0'

    if (!fromRaw) {
      return new NextResponse('OK', { status: 200 })
    }

    // TypeScript narrowing: from is now guaranteed to be string
    const from: string = fromRaw

    // Skip all lead/auto-text flows for internal team numbers
    if (TEAM_NUMBERS.has(from)) {
      return new NextResponse('OK', { status: 200 })
    }

    // Direct company-line calls are logged from the <Dial> action callback,
    // where Twilio gives us the agent leg result. The parent call often ends as
    // "completed" even when the agent leg was no-answer because the caller
    // reached voicemail, so logging it here would misstate the outcome.
    if (to && DIRECT_RING_NUMBERS.has(to)) {
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
      const eventType: 'missed_call' | 'inbound_call' =
        (callStatus === 'no-answer' || callStatus === 'busy') ? 'missed_call' : 'inbound_call'
      onCommunicationEvent(leadId, { type: eventType }).catch(err => console.error('[MANIFEST] Failed:', err))
    }

    // Missed call specific handling (no-answer or busy)
    if (callStatus === 'no-answer' || callStatus === 'busy') {
      if (leadId && leadName) {
        // ── KNOWN LEAD MISSED CALL ──
        await supabase.from('leads')
          .update({ priority: 'hot' })
          .eq('id', leadId)

        // Get intelligent auto-text response using new messaging system
        const { getMissedCallResponse } = await import('@/lib/missed-call-messaging')
        const { getAgentRouting } = await import('@/lib/agent-routing')

        const routing = getAgentRouting(to || TWILIO_PHONE)
        const response = await getMissedCallResponse({
          leadId,
          leadName,
          fromPhone: from,
          calledNumber: to || TWILIO_PHONE,
          isKnownLead: true,
        })

        // Send auto-text if approved by messaging system (rate limits, timing, etc.)
        if (response?.shouldSend && response.message) {
          const optedOut = await isOptedOut(from)
          const { allowed: phoneAllowed } = phoneRateLimit(from)
          const replyFromRaw = to || TWILIO_PHONE
          const fromPhone = from // Capture for closure

          // Type guard: ensure both strings are non-null
          if (!replyFromRaw || !fromPhone) {
            console.error('Missing phone numbers for SMS')
            return new NextResponse('OK', { status: 200 })
          }

          if (!optedOut && phoneAllowed) {
            sendDelayed(async () => {
              // Safe type assertions: all checked above
              await safeSendSMS({
                body: response.message as string,
                from: replyFromRaw as string,
                to: fromPhone as string,
                senderUse: 'reply',
              })
              await supabase.from('lead_activities').insert({
                lead_id: leadId,
                activity_type: 'sms',
                description: response.message,
                agent: 'System',
                metadata: {
                  direction: 'outbound',
                  from: replyFromRaw as string,
                  to: fromPhone,
                  trigger: 'missed_call_auto',
                  variant: response.variant,
                  agent_name: response.agentName,
                }
              })
            }, response.delaySeconds, response.delaySeconds + 5)
          }
        }

        // Alert eligible agents about known lead missed call.
        const missedAlert = `🔥 Missed call from ${leadName} (hot lead)${response?.shouldSend ? '. Auto-text sent' : ''}. Callback in 5 min. ${(process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com')}/leads/${leadId}`
        await sendTeamLeadAlert({
          leadId,
          smsBody: missedAlert,
          trigger: 'known_missed_call_alert',
          source: 'inbound_call',
          push: {
            title: 'Missed Call - Hot Lead',
            body: `${leadName} called and got no answer.`,
            url: `/leads/${leadId}`,
            tag: 'missed-call',
          },
          metadata: {
            from,
            calledNumber: to || TWILIO_PHONE,
            callSid,
            auto_text_sent: Boolean(response?.shouldSend),
          },
        })

        // 5-min callback task assigned to the agent whose number was called
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          activity_type: 'task',
          description: `Callback: Missed call from ${leadName}`,
          agent: 'System',
          metadata: {
            task_type: 'callback',
            due_date: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
            assigned_to: routing.primary.name,
            priority: 'critical',
            status: 'pending',
            source: 'twilio_missed_call',
            call_sid: callSid,
          }
        })
      } else if (!leadId) {
        // ── UNKNOWN CALLER MISSED CALL ──
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
            full_name: `Missed Call ${formatPhone(from) || from}`,
            phone: from,
            source: 'inbound_call',
            station: 'new',
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

        // Get intelligent auto-text for unknown caller
        const { getMissedCallResponse } = await import('@/lib/missed-call-messaging')

        const response = await getMissedCallResponse({
          leadId: newLeadId,
          leadName: null,
          fromPhone: from,
          calledNumber: to || TWILIO_PHONE,
          isKnownLead: false,
        })

        // Send auto-text if approved
        if (response?.shouldSend && response.message) {
          const unknownOptedOut = await isOptedOut(from)
          const { allowed: unknownPhoneAllowed } = phoneRateLimit(from)
          const unknownReplyFromRaw = to || TWILIO_PHONE
          const fromPhoneUnknown = from

          if (!unknownReplyFromRaw || !fromPhoneUnknown) {
            console.error('Missing phone numbers for unknown SMS')
          } else if (!unknownOptedOut && unknownPhoneAllowed) {
            sendDelayed(async () => {
              await safeSendSMS({
                body: response.message as string,
                from: unknownReplyFromRaw as string,
                to: fromPhoneUnknown as string,
                senderUse: 'reply',
              })
              await supabase.from('lead_activities').insert({
                lead_id: newLeadId,
                activity_type: 'sms',
                description: response.message,
                agent: 'System',
                metadata: {
                  direction: 'outbound',
                  from: unknownReplyFromRaw as string,
                  to: fromPhoneUnknown,
                  trigger: 'missed_call_auto',
                  variant: response.variant,
                  agent_name: response.agentName,
                }
              })
            }, response.delaySeconds, response.delaySeconds + 5)
          }
        }

        // Alert eligible agents about unknown caller.
        const agentAlert = `📞 Missed call from unknown number ${formatPhone(from)}${response?.shouldSend ? '. Auto-text sent' : ''}. Watch for YES reply.${newLeadId ? ' ' + (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com') + '/leads/' + newLeadId : ''}`
        await sendTeamLeadAlert({
          leadId: newLeadId,
          smsBody: agentAlert,
          trigger: 'unknown_missed_call_alert',
          source: 'inbound_call',
          push: {
            title: 'Missed Call - Unknown',
            body: `Unknown number ${formatPhone(from)} called.`,
            url: newLeadId ? `/leads/${newLeadId}` : '/',
            tag: 'missed-call-unknown',
          },
          metadata: {
            from,
            calledNumber: to || TWILIO_PHONE,
            callSid,
            auto_text_sent: Boolean(response?.shouldSend),
          },
        })

        // Briefing event for unknown missed call
        try {
          await supabase.from('ari_briefing_events').insert({
            event_type: 'missed_call',
            priority: 'high',
            title: `Missed call from unknown: ${formatPhone(from)}`,
            description: `Unknown caller${response?.shouldSend ? ', auto-text sent' : ''}. Watch for YES reply.`,
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
