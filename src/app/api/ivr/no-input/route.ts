import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)
const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'

// Internal team numbers — never send auto-texts to these
const TEAM_NUMBERS = new Set([
  '+18167564943', // Casey Davis cell
  '+18163754666', // Casey Davis alt
  '+18166088588', // Ernest cell
  '+18413737722', // Ernest Telegram/cell
  '+18168608588', // Ernest alt
])

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''

  // Send text-back if we have a number and it's not a team member
  if (from && !from.includes('anonymous') && !from.includes('blocked') && !TEAM_NUMBERS.has(from)) {
    const msg = `Thanks for calling Saving KC Homebuyers. Were you looking to sell a property? Reply YES and we'll call you right back.`
    try {
      await twilio.messages.create({ body: msg, from: TWILIO_PHONE, to: from })

      // Log for review
      await supabase.from('lead_activities').insert({
        activity_type: 'sms',
        description: msg,
        agent: 'Ari',
        metadata: { direction: 'outbound', to: from, trigger: 'ivr_no_input', awaiting_yes_reply: true }
      })
    } catch (e) { console.error('No-input text-back failed:', e) }
  }

  return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
}
