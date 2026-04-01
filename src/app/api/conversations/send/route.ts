import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
import { Resend } from 'resend'
import { isOptedOut } from '@/lib/sms-opt-out'

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

      // If explicit fromPhone provided, use it directly (skip messagingServiceSid)
      const effectiveFrom = fromPhone || DEFAULT_TWILIO_PHONE
      const useMessagingService = !fromPhone && TWILIO_MESSAGING_SERVICE

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

      return NextResponse.json({ success: true, sid: msg.sid })
    }

    if (mode === 'email') {
      const emailSubject = subject || 'Message from Saving KC'
      let sent = false

      if (process.env.RESEND_API_KEY) {
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
