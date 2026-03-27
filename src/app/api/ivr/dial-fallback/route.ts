import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  const body = await req.formData()
  const dialStatus = body.get('DialCallStatus') as string

  if (dialStatus === 'completed') {
    return new NextResponse('<Response></Response>', { headers: { 'Content-Type': 'text/xml' } })
  }

  // Casey didn't answer Press 2 call — voicemail
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Hey, you've reached Saving KC Homebuyers. Leave a message and we'll get back to you today.</Say>
  <Record maxLength="60" playBeep="true" />
  <Hangup />
</Response>`
  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
}
