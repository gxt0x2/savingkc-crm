import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

export async function POST(req: Request) {
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const callSid = url.searchParams.get('callSid') || ''

  const body = await req.formData()
  const digit = body.get('Digits') as string

  if (digit === '1') {
    // PRESS 1 — SELLING: record name + address, then dial Casey
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Play>https://crm.savingkc.com/audio/ivr-press1.mp3</Play>
  <Record action="${BASE_URL}/api/ivr/after-record?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}" method="POST" maxLength="30" playBeep="true" />
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  if (digit === '2') {
    // PRESS 2 — EVERYTHING ELSE: log and route to Casey
    if (from) {
      await supabase.from('lead_activities').insert({
        activity_type: 'call',
        description: `Inbound call (Press 2 — non-seller) from ${from}`,
        agent: 'System',
        metadata: { direction: 'inbound', from, callSid, tag: 'non_seller', needs_review: true }
      })
    }

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-fallback?from=${encodeURIComponent(from)}" method="POST" timeout="20">
    <Number>${CASEY_PHONE}</Number>
  </Dial>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  // Invalid input — replay greeting
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/twiml-voice</Redirect>
</Response>`
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
