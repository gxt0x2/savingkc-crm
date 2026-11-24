import { NextResponse } from 'next/server'
import { businessMenuTwiml } from '@/lib/telephony/business-line-ivr'
import { validateTwilioWebhook } from '@/lib/twilio-validate'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

function xml(body: string, status = 200) {
  return new NextResponse(body, { status, headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' } })
}

/**
 * Second pass of the business-line menu (no key or a wrong key on the first).
 * Its own Redirect connects the caller to the team if they still press nothing.
 */
export async function POST(req: Request) {
  try {
    if (!(await validateTwilioWebhook(req))) return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', 403)
  } catch (error) {
    console.error('[IVR/business-menu] Twilio signature validation failed:', error)
    return xml('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', 403)
  }
  const url = new URL(req.url)
  return xml(businessMenuTwiml({
    baseUrl: BASE_URL,
    from: url.searchParams.get('from') || '',
    callSid: url.searchParams.get('callSid') || '',
    calledNumber: url.searchParams.get('calledNumber') || '',
    attempt: 2,
  }))
}
