import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { isOptedOut } from '@/lib/sms-opt-out'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'
import { phoneRateLimit } from '@/middleware/rate-limit'
import { safeSendSMS } from '@/lib/safe-communications'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { supabase } from '@/lib/supabase-lazy'
import { formatPhone } from '@/lib/format'
import { isInternalTestPhone } from '@/lib/internal-test-phones'
import { lookupProspectByPhone } from '@/lib/prospect-lookup'
import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'
import {
  getCallQualityMilestones,
  getGoogleAdsCallQualityMilestones,
  getGoogleAdsPhoneProfile,
  isPpcTrackingNumber,
  parseCallDurationSeconds,
} from '@/lib/call-quality-events'
import {
  createGoogleAdsMissedEscalationTask,
  googleAdsMissedCallerMessage,
  resolveGoogleAdsLeadContext,
} from '@/lib/google-ads-phone'

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

function callerPhoneLabel(raw: string): string {
  return formatPhone(raw) || raw
}

type LeadContext = {
  id: string | null
  name: string | null
  station?: string | null
  isParked?: boolean | null
}

async function resolveProspectLeadContext(phone: string): Promise<LeadContext> {
  for (const variant of phoneLookupVariants(phone)) {
    const matches = await lookupProspectByPhone(variant)
    const linked = matches.find((match) => match.lead_id)
    if (!linked?.lead_id) continue

    const { data } = await supabase
      .from('leads')
      .select('id, full_name, station, is_parked')
      .eq('id', linked.lead_id)
      .limit(1)
      .maybeSingle()

    if (data?.id) {
      return {
        id: data.id,
        name: data.full_name || null,
        station: data.station || null,
        isParked: Boolean(data.is_parked),
      }
    }
    return { id: linked.lead_id, name: linked.owner_1 || null }
  }

  return { id: null, name: null }
}

async function resolveLeadContext(explicitLeadId: string, phone: string): Promise<LeadContext> {
  if (explicitLeadId) {
    const { data } = await supabase
      .from('leads')
      .select('id, full_name, station, is_parked')
      .eq('id', explicitLeadId)
      .limit(1)
      .maybeSingle()
    if (data?.id) {
      return {
        id: data.id,
        name: data.full_name || null,
        station: data.station || null,
        isParked: Boolean(data.is_parked),
      }
    }
    return { id: explicitLeadId, name: null }
  }

  for (const variant of phoneLookupVariants(phone)) {
    const { data } = await supabase
      .from('leads')
      .select('id, full_name, station, is_parked')
      .eq('phone', variant)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data?.id) {
      return {
        id: data.id,
        name: data.full_name || null,
        station: data.station || null,
        isParked: Boolean(data.is_parked),
      }
    }
  }

  return resolveProspectLeadContext(phone)
}

async function ensureDirectInboundContact(lead: LeadContext, phone: string): Promise<LeadContext> {
  if (!phone) return lead

  if (lead.id) {
    const patch: Record<string, unknown> = {
      is_parked: false,
      updated_at: new Date().toISOString(),
    }
    const inactiveStation = !lead.station || ['dead', 'closed_lost'].includes(lead.station)
    if (inactiveStation) patch.station = 'contacted'

    await supabase.from('leads').update(patch).eq('id', lead.id)
    return { ...lead, station: inactiveStation ? 'contacted' : lead.station, isParked: false }
  }

  const { data: created, error } = await supabase
    .from('leads')
    .insert({
      full_name: `Direct Caller ${callerPhoneLabel(phone)}`,
      phone,
      source: 'inbound_call',
      station: 'contacted',
      is_parked: false,
    })
    .select('id, full_name, station, is_parked')
    .single()

  if (error) {
    console.error('[DIAL-RESULT] Failed to create direct inbound contact:', error)
    return lead
  }

  return {
    id: created?.id || null,
    name: created?.full_name || null,
    station: created?.station || null,
    isParked: Boolean(created?.is_parked),
  }
}

type InboundCallQualityInput = {
  leadId: string | null
  from: string
  calledNumber: string
  parentCallSid: string
  dialStatus: string
  dialCallSid: string
  dialCallDuration: number | null
  type: string
  isDirect: boolean
  agentName: string
}

async function logInboundCallQualityMilestones(input: InboundCallQualityInput): Promise<void> {
  const milestones = getCallQualityMilestones(input.dialCallDuration)
  if (!milestones.length) return

  const dedupeKey = input.dialCallSid || input.parentCallSid
  const isPpcCall = isPpcTrackingNumber(input.calledNumber)
  const isTestCall = isInternalTestPhone(input.from)
  const profile = getGoogleAdsPhoneProfile(input.calledNumber)
  const googleAdsEvents = new Set(getGoogleAdsCallQualityMilestones(input.dialCallDuration).map((milestone) => milestone.event))

  for (const milestone of milestones) {
    try {
      if (dedupeKey) {
        const { data: existing } = await supabase
          .from('lead_activities')
          .select('id')
          .eq('metadata->>source', 'call_quality_milestone')
          .eq('metadata->>event', milestone.event)
          .eq('metadata->>dedupeKey', dedupeKey)
          .limit(1)

        if (existing && existing.length > 0) continue
      }

      const metadata = {
        source: 'call_quality_milestone',
        event: milestone.event,
        event_type: 'call_quality',
        optimization_role: 'secondary',
        conversion_value: milestone.conversionValue,
        currency: 'USD',
        threshold_seconds: milestone.seconds,
        duration: input.dialCallDuration,
        outcome: 'connected',
        direction: 'inbound',
        from: input.from,
        to: input.calledNumber,
        is_test: isTestCall,
        calledNumber: input.calledNumber,
        callSid: input.parentCallSid,
        dialStatus: input.dialStatus,
        dialCallSid: input.dialCallSid,
        dedupeKey,
        type: input.type,
        isDirect: input.isDirect,
        agentName: input.agentName,
        ...(isPpcCall && {
          traffic_source: 'google_ads',
          campaign: profile.campaign,
          lead_source: profile.source,
          tracking_number: profile.trackingDigits,
          landing_page: profile.landingPage,
          phone_profile: profile.key,
        }),
      }

      const { data: activity, error } = await supabase
        .from('lead_activities')
        .insert({
          lead_id: input.leadId,
          activity_type: 'status_change',
          description: `Call quality milestone: ${milestone.label}`,
          agent: 'System',
          metadata,
        })
        .select('id')
        .single()

      if (error) {
        console.error('[DIAL-RESULT] Call quality milestone insert failed:', error)
        continue
      }

      if (isPpcCall && !isTestCall && googleAdsEvents.has(milestone.event)) {
        await enqueuePpcConversion({
          eventName: milestone.event,
          eventCategory: 'call',
          leadId: input.leadId,
          activityId: activity?.id ?? null,
          dedupeKey: `call:${dedupeKey || `${input.from}:${input.calledNumber}`}:${milestone.event}`,
          optimizationRole: 'secondary',
          conversionValue: milestone.conversionValue,
          attribution: {
            utm_source: 'google',
            utm_medium: 'cpc',
            utm_campaign: profile.campaign,
          },
          payload: metadata,
        })
      }
    } catch (error) {
      console.error('[DIAL-RESULT] Call quality milestone logging failed:', error)
    }
  }
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
    const dialCallDuration = parseCallDurationSeconds(dialCallDurationRaw)

    console.log(`[DIAL-RESULT] type=${type} dialStatus=${dialStatus} from=${from} calledNumber=${calledNumber}`)

    const routing = getAgentRouting(calledNumber)
    const isDirect = type === 'direct'
    let lead = await resolveLeadContext(leadId, from)
    const isPpcCall = isPpcTrackingNumber(calledNumber)
    const isGoogleAdsCall = isPpcCall || type === 'google_ads'
    const isInternalTestCaller = isInternalTestPhone(from)
    const googleAdsProfile = getGoogleAdsPhoneProfile(calledNumber)
    if (isDirect && from && !isInternalTestCaller) {
      lead = await ensureDirectInboundContact(lead, from)
    }

    let resolvedLeadId = isGoogleAdsCall && isInternalTestCaller ? null : lead.id
    let callerLabel = lead.name || callerPhoneLabel(from)

    if (!resolvedLeadId && isGoogleAdsCall && !isInternalTestCaller) {
      const googleAdsLead = await resolveGoogleAdsLeadContext(from, calledNumber)
      resolvedLeadId = googleAdsLead.leadId
      callerLabel = googleAdsLead.leadName || (resolvedLeadId ? `${googleAdsProfile.label} Caller ${callerPhoneLabel(from)}` : callerLabel)
    }

    const shouldTrackConnectedCall = Boolean(resolvedLeadId || isDirect || isGoogleAdsCall)

  if (dialStatus === 'completed') {
    // Agent answered — log it, no auto-text needed
    if (shouldTrackConnectedCall) {
      await supabase.from('lead_activities').insert({
        lead_id: resolvedLeadId,
        activity_type: 'call',
        description: isDirect
          ? `Direct inbound call from ${callerLabel} connected live with ${routing.primary.name}${dialCallDuration != null ? ` — ${dialCallDuration}s` : ''}`
          : isGoogleAdsCall
            ? `Inbound ${googleAdsProfile.label} call from ${callerPhoneLabel(from)} connected live with agent${dialCallDuration != null ? ` — ${dialCallDuration}s` : ''}`
          : `Inbound ${type === 'seller' ? 'seller' : 'caller'} connected live with agent`,
        agent: 'System',
        metadata: {
          outcome: 'connected',
          direction: 'inbound',
          from,
          calledNumber,
          callSid: parentCallSid,
          dialStatus,
          dialCallSid,
          dialCallDuration,
          type,
          is_test: isInternalTestCaller,
          ...(isGoogleAdsCall && {
            source: googleAdsProfile.source,
            traffic_source: 'google_ads',
            campaign: googleAdsProfile.campaign,
            tracking_number: googleAdsProfile.trackingDigits,
            landing_page: googleAdsProfile.landingPage,
            phone_profile: googleAdsProfile.key,
          }),
        }
      })

      await logInboundCallQualityMilestones({
        leadId: resolvedLeadId,
        from,
        calledNumber,
        parentCallSid,
        dialStatus,
        dialCallSid,
        dialCallDuration,
        type,
        isDirect,
        agentName: routing.primary.name,
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
    if (isGoogleAdsCall) {
      await supabase.from('lead_activities').insert({
        lead_id: resolvedLeadId,
        activity_type: 'call',
        description: `Both agents missed inbound ${googleAdsProfile.label} call from ${callerPhoneLabel(from)}`,
        agent: 'System',
        metadata: {
          outcome: 'missed',
          direction: 'inbound',
          from,
          calledNumber,
          callSid: parentCallSid,
          dialStatus,
          dialCallSid,
          dialCallDuration,
          type,
          is_test: isInternalTestCaller,
          source: googleAdsProfile.source,
          traffic_source: 'google_ads',
          campaign: googleAdsProfile.campaign,
          tracking_number: googleAdsProfile.trackingDigits,
          landing_page: googleAdsProfile.landingPage,
          phone_profile: googleAdsProfile.key,
        }
      })

      if (!isInternalTestCaller) {
        await createGoogleAdsMissedEscalationTask({
          leadId: resolvedLeadId,
          from,
          calledNumber,
          callSid: parentCallSid,
          dialCallSid,
          dialCallDuration,
          routing,
        })
      }
    } else {
    // Alert both agents for IVR calls
    const missedMsg = `MISSED: Inbound ${type === 'seller' ? 'seller' : 'caller'} ${from} — nobody answered. Going to voicemail.\n${BASE_URL}/leads/${resolvedLeadId}`
    await sendTeamLeadAlert({
      leadId: resolvedLeadId,
      smsBody: missedMsg,
      trigger: 'ivr_missed_call_alert',
      source: 'inbound_ivr',
      push: {
        title: 'Missed Inbound Call',
        body: `${type === 'seller' ? 'Seller' : 'Caller'} ${from} reached voicemail.`,
        url: `/leads/${resolvedLeadId}`,
        tag: 'ivr-missed-call',
      },
      metadata: {
        outcome: 'missed',
        direction: 'inbound',
        from,
        calledNumber,
        callSid: parentCallSid,
        dialStatus,
        dialCallSid,
        dialCallDuration,
        type,
      },
    })

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
  }

  // Auto-text ONLY when both agents miss IVR calls (not direct calls)
  if (from && resolvedLeadId && !isDirect && !isInternalTestCaller) {
    const optedOut = await isOptedOut(from)
    const { allowed: phoneOk } = phoneRateLimit(from)
    if (!optedOut && phoneOk) {
      const isColdCallback = calledNumber && ['+18163100845','+18162538313','+18164761344','+18164761589','+18166404701','+18165788107','+18166408032','+18166536616'].includes(calledNumber)
      const autoText = isGoogleAdsCall
        ? googleAdsMissedCallerMessage(calledNumber)
        : isColdCallback
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
            metadata: {
              direction: 'outbound',
              to: from,
              trigger: isGoogleAdsCall ? 'google_ads_missed_call_followup' : 'missed_call_followup',
              ...(isGoogleAdsCall && {
                source: googleAdsProfile.source,
                traffic_source: 'google_ads',
                campaign: googleAdsProfile.campaign,
                tracking_number: googleAdsProfile.trackingDigits,
                landing_page: googleAdsProfile.landingPage,
                phone_profile: googleAdsProfile.key,
                calledNumber,
              }),
            }
          })
        }, isGoogleAdsCall ? 60 : 180, isGoogleAdsCall ? 90 : 300)
      }
    }
  }

  // Route caller to voicemail
  const vmAgent = isGoogleAdsCall ? 'SavingKC' : routing.primary.name
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
