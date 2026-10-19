import { NextResponse } from 'next/server'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { rateLimit, rateLimitConfigs, getClientIp } from '@/middleware/rate-limit'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { formatPhone } from '@/lib/format'
import { supabase } from '@/lib/supabase-lazy'

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

// Internal team numbers — never trigger lead flows for these
const TEAM_NUMBERS = new Set([
  '+18167564943', // Casey personal
  '+18167277667', // Casey company
  '+18166088588', // Ernest company
  '+18162262552', // Ernest forwarding
])

// Parent callback skips these. The <Dial> action owns the outcome, because the
// parent often ends as "completed" after voicemail.
const PARENT_CALLBACK_SKIP_NUMBERS = new Set([
  '+18167277667', // Casey company
  '+18166088588', // Ernest company
])

// A 0-second parent no-answer or busy on these lines is a direct ring, not an abandon.
const DIRECT_RING_NUMBERS = new Set([
  '+18166088588',
  '+18166088858',
])

function isAbandonedBeforeAnswer(callStatus: string, durationSeconds: number, calledNumber: string | null): boolean {
  return (callStatus === 'no-answer' || callStatus === 'busy')
    && durationSeconds === 0
    && !(calledNumber && DIRECT_RING_NUMBERS.has(calledNumber))
}

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
    if (to && PARENT_CALLBACK_SKIP_NUMBERS.has(to)) {
      return new NextResponse('OK', { status: 200 })
    }

    const durationSeconds = Number.parseInt(duration, 10)
    // Caller hung up before anyone could answer. Keep the lead and the caller
    // auto-text, but do not page the team. Real missed-call alerts come from
    // /api/ivr/dial-result when DialCallStatus is no-answer or busy.
    const abandonedBeforeAnswer = isAbandonedBeforeAnswer(callStatus, durationSeconds, to)
    const loggedStatus = abandonedBeforeAnswer ? 'abandoned_before_answer' : callStatus

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
      description: `Inbound call from ${leadName || from} — ${loggedStatus} (${duration}s)`,
      agent: 'System',
      metadata: {
        direction: 'inbound',
        from,
        to,
        callSid,
        callStatus: loggedStatus,
        duration: parseInt(duration),
        matched_lead: leadId ? true : false,
        lead_name: leadName,
        ...(abandonedBeforeAnswer ? { outcome: 'abandoned_before_answer' } : {}),
      }
    })

    // Ari briefing event for all inbound calls
    if (leadId) {
      await supabase.from('ari_briefing_events').insert({
        event_type: 'inbound_call',
        priority: callStatus === 'completed' || abandonedBeforeAnswer ? 'medium' : 'high',
        title: `Inbound call from ${leadName || from} — ${loggedStatus}`,
        description: `Duration: ${duration}s. Status: ${loggedStatus}.`,
        lead_id: leadId,
        action_url: `/leads/${leadId}`
      })

    }

    // Missed call specific handling (no-answer or busy)
    if (callStatus === 'no-answer' || callStatus === 'busy') {
      if (leadId && leadName) {
        // ── KNOWN LEAD MISSED CALL ──
        await supabase.from('leads')
          .update({ priority: 'hot' })
          .eq('id', leadId)

        // Alert eligible agents about known lead missed call.
        // Abandoned calls stay in the CRM. The caller is not texted.
        if (!abandonedBeforeAnswer) {
          const missedAlert = `🔥 Missed call from ${leadName} (hot lead). Callback in 5 min. ${(process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com')}/leads/${leadId}`
          await sendTeamLeadAlert({
            leadId,
            smsBody: missedAlert,
            trigger: 'known_missed_call_alert',
            source: 'inbound_call',
            calledNumber: to || TWILIO_PHONE,
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
              auto_text_sent: false,
            },
          })
        }

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

        }

        // Alert eligible agents about unknown caller.
        // Abandoned calls still create the lead. The caller is not texted.
        if (!abandonedBeforeAnswer) {
          const agentAlert = `📞 Missed call from unknown number ${formatPhone(from)}. ${newLeadId ? (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com') + '/leads/' + newLeadId : ''}`
          await sendTeamLeadAlert({
            leadId: newLeadId,
            smsBody: agentAlert,
            trigger: 'unknown_missed_call_alert',
            source: 'inbound_call',
            calledNumber: to || TWILIO_PHONE,
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
              auto_text_sent: false,
            },
          })
        }

        // Briefing event for unknown missed call
        try {
          await supabase.from('ari_briefing_events').insert({
            event_type: abandonedBeforeAnswer ? 'abandoned_before_answer' : 'missed_call',
            priority: abandonedBeforeAnswer ? 'medium' : 'high',
            title: abandonedBeforeAnswer
              ? `Caller abandoned before answer: ${formatPhone(from)}`
              : `Missed call from unknown: ${formatPhone(from)}`,
            description: abandonedBeforeAnswer
              ? 'Caller hung up before answer.'
              : 'Unknown caller. No automated text was sent.',
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
