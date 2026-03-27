import { NextResponse } from 'next/server'

const CASEY_PHONE = process.env.CASEY_PHONE || '+18167564943'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

export async function POST(req: Request) {
  const body = await req.formData()
  const callSid = body.get('CallSid') as string
  const from = body.get('From') as string

  // Main IVR greeting
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${BASE_URL}/api/ivr/handle-input?from=${encodeURIComponent(from)}&callSid=${encodeURIComponent(callSid)}" method="POST" timeout="8">
    <Play>https://crm.savingkc.com/audio/ivr-greeting.mp3</Play>
  </Gather>
  <!-- No input fallback -->
  <Redirect method="POST">${BASE_URL}/api/ivr/no-input?from=${encodeURIComponent(from)}</Redirect>
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
