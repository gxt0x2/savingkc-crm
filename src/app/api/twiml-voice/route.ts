import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = await req.formData()
  const to = body.get('To') as string
  const from = process.env.TWILIO_PHONE_NUMBER!

  let twiml: string
  if (to && to.startsWith('+')) {
    // Outbound PSTN call
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${from}">
    <Number>${to}</Number>
  </Dial>
</Response>`
  } else {
    // Client call (browser to browser)
    twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial>
    <Client>${to || 'crm-user'}</Client>
  </Dial>
</Response>`
  }

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  })
}
