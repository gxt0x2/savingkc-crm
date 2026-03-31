import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import twilio from 'twilio'
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
    const { leadId, phone, body, mode, fromPhone, agent } = await req.json()

    if (!phone || !body?.trim()) {
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
      // Log note for now — email send not yet wired
      await supabase.from('lead_activities').insert({
        lead_id: leadId || null,
        activity_type: 'email',
        description: body.trim(),
        agent: agent || 'System',
        metadata: {
          direction: 'outbound',
          to: phone,
          subject: 'Message from Saving KC',
        },
      })
      return NextResponse.json({ success: true, note: 'Email logged (SMTP not yet configured)' })
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
