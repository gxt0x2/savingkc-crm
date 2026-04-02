import { NextResponse } from 'next/server'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

const COLD_CALL_NUMBERS = new Set([
  '+18163100845', '+18162538313', '+18164761344', '+18164761589',
  '+18166404701', '+18165788107', '+18166408032', '+18166536616',
])

// Standard greetings (company name included)
const GREETINGS: Record<string, string> = {
  Ernest: `You've reached Ernest with Saving KC Homebuyers. I'm unable to take your call right now. Please leave a message after the beep and I'll get back to you as soon as possible.`,
  Casey: `You've reached Casey with Saving KC Homebuyers. I'm unable to take your call right now. Please leave a message after the beep and I'll get back to you as soon as possible.`,
}
const DEFAULT_GREETING = `You've reached Saving KC Homebuyers. No one is available to take your call right now. Please leave a message after the beep and we'll get back to you as soon as possible.`

// Cold call greetings (no company name)
const COLD_GREETING = `Hey, sorry we missed you. Leave a message after the beep and we'll call you right back.`

export async function POST(req: Request) {
  const url = new URL(req.url)
  const agent = url.searchParams.get('agent') || ''
  const from = url.searchParams.get('from') || ''
  const leadId = url.searchParams.get('leadId') || ''
  const calledNumber = url.searchParams.get('calledNumber') || ''

  const isColdCall = COLD_CALL_NUMBERS.has(calledNumber)
  const greeting = isColdCall ? COLD_GREETING : (GREETINGS[agent] || DEFAULT_GREETING)

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${greeting}</Say>
  <Record action="${BASE_URL}/api/ivr/voicemail-recording?agent=${encodeURIComponent(agent)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}" method="POST" maxLength="120" playBeep="true" timeout="5" />
  <Say voice="Polly.Matthew">We didn't receive a message. Goodbye.</Say>
  <Hangup />
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
