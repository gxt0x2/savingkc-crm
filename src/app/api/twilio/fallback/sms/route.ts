import { formatPhone } from '@/lib/format'
import { queueInboundLeadAttribution } from '@/lib/server/inbound-lead-attribution'
import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { phoneLookupVariants } from '@/lib/google-ads-phone'
import { processInboundSmsConsent } from '@/lib/sms-consent-audit'
import { captureInboundMms, InboundMmsInputError, readTwilioInboundMedia } from '@/lib/server/inbound-mms'
import {
  inboundConversationTarget,
  isTeamCompanyLineSender,
  queueInboundSmsPush,
  teamInboundSenderName,
} from '@/lib/server/inbound-sms-thread'
import {
  buildCarrierFallbackSmsLeadSeed,
  emptyTwiml,
} from '@/lib/telephony/carrier-fallback'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { supabase } from '@/lib/supabase-lazy'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const XML_HEADERS = {
  'Content-Type': 'text/xml',
  'Cache-Control': 'no-store, max-age=0',
}

function xmlResponse(body = emptyTwiml(), status = 200) {
  return new NextResponse(body, { status, headers: XML_HEADERS })
}

async function findLeadId(phone: string): Promise<string | null> {
  for (const variant of phoneLookupVariants(phone)) {
    const { data } = await supabase.from('leads').select('id').eq('phone', variant).limit(1).maybeSingle()
    if (data?.id) return data.id
  }
  return null
}

export async function POST(request: Request) {
  if (!await validateTwilioWebhook(request)) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const body = await request.formData()
  const from = String(body.get('From') || '')
  const to = String(body.get('To') || '')
  const message = String(body.get('Body') || '')
  const messageSid = String(body.get('MessageSid') || '')
  let mediaCount = 0
  try {
    mediaCount = readTwilioInboundMedia(body).length
  } catch (error) {
    if (error instanceof InboundMmsInputError) return new NextResponse('Missing required fields', { status: 400 })
    throw error
  }
  if (!from || !to || !messageSid || (!message.trim() && mediaCount === 0)) {
    return new NextResponse('Missing required fields', { status: 400 })
  }

  try {
    const consentTwiml = await processInboundSmsConsent({ from, to, keyword: message, messageSid, source: 'carrier_sms_fallback' })
    if (consentTwiml) return xmlResponse(consentTwiml)
  } catch (error) {
    console.error('[carrier-sms-fallback] SMS consent persistence failed', error)
    return xmlResponse(emptyTwiml(), 503)
  }

  try {
    const { data: existingActivity } = await supabase
      .from('lead_activities')
      .select('id')
      .eq('metadata->>message_sid', messageSid)
      .limit(1)
      .maybeSingle()
    if (existingActivity?.id) return xmlResponse()

    const routing = getAgentRouting(to)
    const teamSender = isTeamCompanyLineSender(from)
    let captured: Awaited<ReturnType<typeof captureInboundMms>>
    try {
      captured = await captureInboundMms({ form: body, messageSid })
    } catch (error) {
      console.error('[carrier-sms-fallback] inbound MMS store failed:', error instanceof Error ? error.message : 'failed')
      return xmlResponse(emptyTwiml(), 503)
    }
    const messageText = captured.description
    let leadId = teamSender ? null : await findLeadId(from)
    if (!leadId && !teamSender) {
      const { data: created, error } = await supabase
        .from('leads')
        .insert(buildCarrierFallbackSmsLeadSeed({ from, to, assignedAgent: routing.primary.name, messageSid }))
        .select('id')
        .single()
      if (error) throw error
      leadId = created?.id || null
    }
    if (leadId) queueInboundLeadAttribution({ leadId, channel: 'sms', callerNumber: from, calledNumber: to })

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'sms',
      description: messageText,
      agent: 'System',
      metadata: {
        direction: 'received',
        from,
        to,
        message_sid: messageSid,
        source: 'carrier_sms_fallback',
        assigned_to: routing.primary.name,
        ...captured.metadata,
        ...(teamSender ? { team_sender: true } : {}),
      },
    })

    const target = inboundConversationTarget(leadId, from)
    if (teamSender) {
      queueInboundSmsPush(to, {
        title: `Team SMS: ${teamInboundSenderName(from)}`,
        body: messageText.slice(0, 80),
        tag: 'team-sms',
      }, { leadId: null, from, messageSid })
    } else {
      await sendTeamLeadAlert({
        leadId,
        conversationThreadId: target.threadId,
        smsBody: `Carrier fallback captured an inbound text from ${formatPhone(from)} to ${formatPhone(to)}: “${messageText.slice(0, 180)}”`,
        trigger: 'carrier_sms_fallback',
        source: 'inbound_sms',
        calledNumber: to,
        push: {
          title: 'Inbound text recovered',
          body: `${formatPhone(from)}: ${messageText.slice(0, 100)}`,
          url: target.url,
          tag: `carrier-sms-fallback-${messageSid}`,
        },
        metadata: { from, to, messageSid, assignedTo: routing.primary.name },
      })
    }
  } catch (error) {
    console.error('[carrier-sms-fallback] capture failed', error)
  }

  // Always acknowledge a valid Twilio fallback so the carrier does not retry
  // a partially persisted message and create duplicate CRM work.
  return xmlResponse()
}
