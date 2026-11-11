import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { formatPhone } from '@/lib/format'
import { supabase } from '@/lib/supabase-lazy'
import { lookupProspectByPhone } from '@/lib/prospect-lookup'
import { createEnrichedLeadFromProspect } from '@/lib/prospect-to-lead'
import { readPhoneEnv } from '@/lib/phone-config'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import { agentDialTwiml } from '@/lib/telephony/business-line-ivr'
import { queueInboundLeadAttribution } from '@/lib/server/inbound-lead-attribution'

const TWILIO_PHONE = readPhoneEnv('TWILIO_PHONE_NUMBER', '+18163077835')
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
const INVALID_TWILIO_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>'

function invalidTwilioResponse() {
  return new NextResponse(INVALID_TWILIO_TWIML, {
    status: 403,
    headers: { 'Content-Type': 'text/xml', 'Cache-Control': 'no-store' },
  })
}

const TEAM_NUMBERS = new Set([
  '+18167564943', '+18167277667', '+18166088588', '+18162262552',
])

/**
 * Spam check: 3+ no-input calls from same number in 7 days = likely robocall.
 */
async function isLikelySpam(phone: string): Promise<boolean> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count } = await supabase
    .from('lead_activities')
    .select('id', { count: 'exact', head: true })
    .eq('metadata->>tag', 'ivr_no_input')
    .eq('metadata->>from', phone)
    .gte('created_at', sevenDaysAgo)

  return (count ?? 0) >= 3
}

export async function POST(req: Request) {
  try {
    if (!(await validateTwilioWebhook(req))) return invalidTwilioResponse()
  } catch (error) {
    console.error('[IVR/no-input] Twilio signature validation failed:', error)
    return invalidTwilioResponse()
  }

  try {
    const url = new URL(req.url)
    const from = url.searchParams.get('from') || ''
    const calledNumber = url.searchParams.get('calledNumber') || TWILIO_PHONE
    // Only used to look up where the call was forwarded from.
    const callSid = await req.formData().then((body) => String(body.get('CallSid') || ''), () => '')

    const routing = getAgentRouting(calledNumber)

  if (from && !from.includes('anonymous') && !from.includes('blocked') && !TEAM_NUMBERS.has(from)) {

    // Spam filter
    const spam = await isLikelySpam(from)
    if (spam) {
      await supabase.from('lead_activities').insert({
        lead_id: null,
        activity_type: 'call',
        description: `Spam filtered: repeat no-input caller ${formatPhone(from)} (3+ in 7 days)`,
        agent: 'System',
        metadata: { direction: 'inbound', from, to: calledNumber, calledNumber, team: 'Acquisitions', tag: 'ivr_no_input', spam: true }
      })
      // A person who just keeps not pressing still deserves a way through:
      // straight to voicemail instead of a silent hang-up.
      return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Redirect method="POST">${BASE_URL}/api/ivr/voicemail?agent=${encodeURIComponent(routing.primary.name)}&amp;from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(calledNumber)}</Redirect></Response>`, { headers: { 'Content-Type': 'text/xml' } })
    }

    // Find or create lead (dedup by phone)
    let noInputLeadId: string | null = null
    const { data: existingLead } = await supabase
      .from('leads')
      .select('id')
      .eq('phone', from)
      .limit(1)
      .single()

    if (existingLead?.id) {
      noInputLeadId = existingLead.id
    } else {
      const prospectMatches = await lookupProspectByPhone(from)
      if (prospectMatches.length > 0) {
        noInputLeadId = await createEnrichedLeadFromProspect(
          prospectMatches[0],
          from,
          'inbound_ivr',
          'hot',
        )
      }
    }

    if (!noInputLeadId) {
      const { data: newLead } = await supabase.from('leads').insert({
        full_name: `Caller ${formatPhone(from) || from}`,
        phone: from,
        source: 'inbound_ivr_no_input',
        station: 'new',
        priority: 'normal',
      }).select('id').single()
      noInputLeadId = newLead?.id || null
    }

    queueInboundLeadAttribution({ leadId: noInputLeadId, channel: 'call', callerNumber: from, calledNumber, callSid })

    // Log call (feeds spam counter for future calls)
    await supabase.from('lead_activities').insert({
      lead_id: noInputLeadId,
      activity_type: 'call',
      description: `Inbound call from ${formatPhone(from)} — no IVR input, routing to agents`,
      agent: 'System',
      metadata: { direction: 'inbound', from, to: calledNumber, calledNumber, team: 'Acquisitions', tag: 'ivr_no_input' }
    })

    // NO auto-text here. If both agents miss, dial-result sends it after 3-5 min.

    // Ring both agents' apps and cells (announced) — let dial-result handle the outcome
    const twiml = agentDialTwiml({
      baseUrl: BASE_URL,
      from,
      calledNumber,
      companyNumber: routing.primary.companyNumber,
      leadId: noInputLeadId || '',
      type: 'no_input',
      cells: [routing.primary.phone, routing.secondary.phone],
      ringApps: true,
      announce: true,
    })
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
  } catch (error) {
    console.error('[IVR/no-input] Critical error:', error)
    // Emergency fallback: ring both agents
    const emergencyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="15">
    <Number>+18162262552</Number>
    <Number>+18167564943</Number>
  </Dial>
</Response>`
    return new NextResponse(emergencyTwiml, { headers: { 'Content-Type': 'text/xml' } })
  }
}
