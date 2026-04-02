import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { isOptedOut } from '@/lib/sms-opt-out'
import { checkAutoAdvance } from '@/lib/pipeline-auto-advance'
import { onCommunicationEvent } from '@/lib/manifest-sync'
import { isDuplicateSms, logSmsSend } from '@/lib/sms-dedup'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
)

const DEFAULT_TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const TWILIO_MESSAGING_SERVICE = process.env.TWILIO_MESSAGING_SERVICE

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const { leadId, phone, body, mode, fromPhone, agent, to, subject } = json

    if (mode === 'email') {
      if (!to || !body?.trim()) {
        return NextResponse.json({ error: 'Missing email recipient or body' }, { status: 400 })
      }
    } else if (!phone || !body?.trim()) {
      return NextResponse.json({ error: 'Missing phone or message body' }, { status: 400 })
    }

    if (mode === 'sms') {
      // Check opt-out before sending
      if (await isOptedOut(phone)) {
        return NextResponse.json({ error: 'This number has opted out of SMS messages' }, { status: 400 })
      }

      // Check 24hr dedup
      if (await isDuplicateSms(phone, body)) {
        return NextResponse.json({ error: 'Duplicate SMS — same message sent to this number within 24 hours' }, { status: 409 })
      }

      // Auto-detect the right "from" number: use the Twilio number this lead last contacted
      let effectiveFrom = fromPhone || ''
      if (!effectiveFrom && leadId) {
        const { data: lastInbound } = await supabase
          .from('lead_activities')
          .select('metadata')
          .eq('lead_id', leadId)
          .eq('activity_type', 'sms')
          .eq('metadata->>direction', 'received')
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
        if (lastInbound?.metadata?.to) {
          effectiveFrom = lastInbound.metadata.to as string
        }
      }
      // Also try matching by phone if no leadId
      if (!effectiveFrom && phone) {
        const { data: lastInbound } = await supabase
          .from('lead_activities')
          .select('metadata')
          .eq('activity_type', 'sms')
          .eq('metadata->>direction', 'received')
          .eq('metadata->>from', phone)
          .order('created_at', { ascending: false })
          .limit(1)
          .single()
        if (lastInbound?.metadata?.to) {
          effectiveFrom = lastInbound.metadata.to as string
        }
      }
      if (!effectiveFrom) effectiveFrom = DEFAULT_TWILIO_PHONE
      const useMessagingService = false // Always use direct number for consistency

      const msg = await twilioClient.messages.create({
        body: body.trim(),
        from: useMessagingService ? undefined : effectiveFrom,
        messagingServiceSid: useMessagingService ? TWILIO_MESSAGING_SERVICE : undefined,
        to: phone,
      })

      // Log outbound SMS to Supabase
      await supabase.from('lead_activities').insert({
        lead_id: leadId || null,
        activity_type: 'sms',
        description: body.trim(),
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
          from: effectiveFrom,
          to: phone,
          message_sid: msg.sid,
        },
      })

      // Log to dedup table
      logSmsSend(phone, body.trim(), effectiveFrom, leadId || undefined).catch(() => {})

      // Auto-advance pipeline on first outbound contact
      if (leadId) {
        checkAutoAdvance(leadId, 'outbound_contact').catch(() => {})
        onCommunicationEvent(leadId, { type: 'outbound_sms', content: body.trim() }).catch(() => {})
      }

      return NextResponse.json({ success: true, sid: msg.sid })
    }

    if (mode === 'email') {
      const emailSubject = subject || 'Message from Saving KC'
      let sent = false

      if (process.env.RESEND_API_KEY) {
        const { Resend } = await import('resend')
        const resend = new Resend(process.env.RESEND_API_KEY)
        const fromEmail = process.env.RESEND_FROM_EMAIL || 'ernest@savingkc.com'
        await resend.emails.send({
          from: `Saving KC <${fromEmail}>`,
          to: [to],
          subject: emailSubject,
          text: body.trim(),
        })
        sent = true
      }

      await supabase.from('lead_activities').insert({
        lead_id: leadId || null,
        activity_type: 'email',
        description: body.trim(),
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
          to,
          subject: emailSubject,
          sent,
        },
      })

      if (leadId) {
        checkAutoAdvance(leadId, 'outbound_contact').catch(() => {})
        onCommunicationEvent(leadId, { type: 'email', content: body.trim() }).catch(() => {})
      }

      return NextResponse.json({ success: true, sent })
    }

    if (mode === 'call') {
      // Log call note
      await supabase.from('lead_activities').insert({
        lead_id: leadId || null,
        activity_type: 'call',
        description: body.trim(),
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
          to: phone,
          note: true,
        },
      })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown mode' }, { status: 400 })
  } catch (err: any) {
    console.error('conversations/send error:', err)
    return NextResponse.json({ error: err.message || 'Internal error' }, { status: 500 })
  }
}
