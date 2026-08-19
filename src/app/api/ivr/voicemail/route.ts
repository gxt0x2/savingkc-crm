import { NextResponse } from 'next/server'
import { validateTwilioWebhook } from '@/lib/twilio-validate'

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
const INVALID_TWILIO_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'

function invalidTwilioResponse() {
  return new NextResponse(INVALID_TWILIO_TWIML, {
    status: 403,
    headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' },
  })
}

const COLD_CALL_NUMBERS = new Set([
  '+18163100845', '+18162538313', '+18164761344', '+18164761589',
  '+18166404701', '+18165788107', '+18166408032', '+18166536616',
])

// Standard greetings (company name included)
const GREETING_AUDIO: Record<string, string> = {
  SavingKC: `${BASE_URL}/audio/ivr-voicemail.mp3`,
  Ernest: `${BASE_URL}/audio/ernest-vm.mp3`,
  Casey: `${BASE_URL}/audio/casey-vm-v2.mp3`,
}
const GREETINGS: Record<string, string> = {
  Casey: `You've reached Casey with Saving KC Homebuyers. I'm unable to take your call right now. Please leave a message after the beep and I'll get back to you as soon as possible.`,
}
const DEFAULT_GREETING = `You've reached Saving KC Homebuyers. No one is available to take your call right now. Please leave a message after the beep and we'll get back to you as soon as possible.`

// Cold call greetings (no company name)
const COLD_GREETING = `Hey, sorry we missed you. Leave a message after the beep and we'll call you right back.`

export async function POST(req: Request) {
  try {
    if (!(await validateTwilioWebhook(req))) return invalidTwilioResponse()
  } catch (error) {
    console.error('[IVR/voicemail] Twilio signature validation failed:', error)
    return invalidTwilioResponse()
  }

  try {
    const url = new URL(req.url)
    const agent = url.searchParams.get('agent') || ''
    const from = url.searchParams.get('from') || ''
    const leadId = url.searchParams.get('leadId') || ''
    const calledNumber = url.searchParams.get('calledNumber') || ''

    console.log(`[VOICEMAIL] agent=${agent} from=${from} calledNumber=${calledNumber}`)

  const isColdCall = COLD_CALL_NUMBERS.has(calledNumber)

  // Use recorded greetings where available, text-to-speech as the fallback.
  const audioGreeting = GREETING_AUDIO[agent]
  const textGreeting = isColdCall ? COLD_GREETING : (GREETINGS[agent] || DEFAULT_GREETING)

  const greetingTag = audioGreeting
    ? `<Play>${audioGreeting}</Play>`
    : `<Say voice="Polly.Matthew">${textGreeting}</Say>`

  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${greetingTag}
  <Record action="${BASE_URL}/api/ivr/voicemail-recording?agent=${encodeURIComponent(agent)}&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(leadId)}" method="POST" maxLength="120" playBeep="true" timeout="5" />
  <Say voice="Polly.Matthew">We didn't receive a message. Goodbye.</Say>
  <Hangup />
</Response>`

  return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  } catch (error) {
    console.error('[IVR/voicemail] Critical error:', error)
    // Emergency fallback: simple voicemail
    const emergencyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Matthew">Please leave a message after the beep.</Say>
  <Record action="${BASE_URL}/api/ivr/voicemail-recording" method="POST" maxLength="120" playBeep="true"/>
  <Hangup />
</Response>`
    return new NextResponse(emergencyTwiml, { headers: { 'Content-Type': 'text/xml' } })
  }
}
