import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { ensureManifestExists, onCommunicationEvent } from '@/lib/manifest-sync'
import { sendTeamLeadAlert } from '@/lib/lead-team-alerts'
import { phoneLookupVariants } from '@/lib/google-ads-phone'
import { handleOptIn, handleOptOut, isStartKeyword, isStopKeyword } from '@/lib/sms-opt-out'
import {
  buildCarrierFallbackSmsLeadSeed,
  buildCarrierFallbackSmsTask,
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

function xmlResponse(body = emptyTwiml()) {
  return new NextResponse(body, { headers: XML_HEADERS })
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
  if (!from || !to || !message || !messageSid) {
    return new NextResponse('Missing required fields', { status: 400 })
  }

  try {
    if (isStopKeyword(message)) {
      await handleOptOut(from, message.trim())
      return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been unsubscribed from Saving KC messages. Reply START to re-subscribe.</Message></Response>')
    }
    if (isStartKeyword(message)) {
      await handleOptIn(from)
      return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Message>You have been re-subscribed to Saving KC messages. Reply STOP to unsubscribe.</Message></Response>')
    }

    const { data: existingActivity } = await supabase
      .from('lead_activities')
      .select('id')
      .eq('metadata->>message_sid', messageSid)
      .limit(1)
      .maybeSingle()
    if (existingActivity?.id) return xmlResponse()

    const routing = getAgentRouting(to)
    let leadId = await findLeadId(from)
    if (!leadId) {
      const { data: created, error } = await supabase
        .from('leads')
        .insert(buildCarrierFallbackSmsLeadSeed({ from, to, assignedAgent: routing.primary.name, messageSid }))
        .select('id')
        .single()
      if (error) throw error
      leadId = created?.id || null
      if (leadId) {
        await supabase.from('lead_activities').insert({
          lead_id: leadId,
          ...buildCarrierFallbackSmsTask({ from, to, assignedAgent: routing.primary.name, messageSid }),
        })
      }
    }

    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'sms',
      description: message,
      agent: 'System',
      metadata: {
        direction: 'received',
        from,
        to,
        message_sid: messageSid,
        source: 'carrier_sms_fallback',
        assigned_to: routing.primary.name,
      },
    })

    if (leadId) {
      ensureManifestExists(leadId).catch((error) => console.error('[carrier-sms-fallback] manifest create failed', error))
      onCommunicationEvent(leadId, { type: 'inbound_sms', content: message }).catch((error) => console.error('[carrier-sms-fallback] manifest update failed', error))
    }

    await sendTeamLeadAlert({
      leadId,
      smsBody: `Carrier fallback captured an inbound text from ${from} to ${to}: “${message.slice(0, 180)}”`,
      trigger: 'carrier_sms_fallback',
      source: 'inbound_sms',
      push: {
        title: 'Inbound text recovered',
        body: `${from}: ${message.slice(0, 100)}`,
        url: leadId ? `/leads/${leadId}` : '/conversations',
        tag: `carrier-sms-fallback-${messageSid}`,
      },
      metadata: { from, to, messageSid, assignedTo: routing.primary.name },
    })
  } catch (error) {
    console.error('[carrier-sms-fallback] capture failed', error)
  }

  // Always acknowledge a valid Twilio fallback so the carrier does not retry
  // a partially persisted message and create duplicate CRM work.
  return xmlResponse()
}
