import { NextResponse } from 'next/server'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

// Agent-specific voicemail greetings
const GREETINGS: Record<string, string> = {
  Ernest: `You've reached Ernest with Saving KC Homebuyers. I'm unable to take your call right now. Please leave a message after the beep and I'll get back to you as soon as possible.`,
  Casey: `You've reached Casey with Saving KC Homebuyers. I'm unable to take your call right now. Please leave a message after the beep and I'll get back to you as soon as possible.`,
}

const DEFAULT_GREETING = `You've reached Saving KC Homebuyers. No one is available to take your call right now. Please leave a message after the beep and we'll get back to you as soon as possible.`

export async function POST(req: Request) {
  const url = new URL(req.url)
  const agent = url.searchParams.get('agent') || ''
  const from = url.searchParams.get('from') || ''
  const leadId = url.searchParams.get('leadId') || ''

  const greeting = GREETINGS[agent] || DEFAULT_GREETING

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">${greeting}</Say>
  <Record action="${BASE_URL}/api/ivr/voicemail-recording?agent=${encodeURIComponent(agent)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}" method="POST" maxLength="120" playBeep="true" timeout="5" />
  <Say voice="Polly.Matthew">We didn't receive a message. Goodbye.</Say>
  <Hangup />
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
