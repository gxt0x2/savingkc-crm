import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''

  // Send text-back if we have a number
  if (from && !from.includes('anonymous') && !from.includes('blocked')) {
    const msg = `Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back.`
    try {
      await twilio.messages.create({ body: msg, from: TWILIO_PHONE, to: from })

      // Log for review
      await supabase.from('lead_activities').insert({
        activity_type: 'sms',
        description: `No-input text-back sent to ${from}`,
        agent: 'Ari',
        metadata: { direction: 'outbound', to: from, trigger: 'ivr_no_input', awaiting_yes_reply: true }
      })
    } catch (e) { console.error('No-input text-back failed:', e) }
  }

  return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
}
