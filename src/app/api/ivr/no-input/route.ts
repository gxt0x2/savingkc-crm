import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { getAgentRouting } from '@/lib/agent-routing'
import { ensureManifestExists } from '@/lib/manifest-sync'
import { formatPhone } from '@/lib/format'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

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
  const url = new URL(req.url)
  const from = url.searchParams.get('from') || ''
  const calledNumber = url.searchParams.get('calledNumber') || TWILIO_PHONE

  const routing = getAgentRouting(calledNumber)

  if (from && !from.includes('anonymous') && !from.includes('blocked') && !TEAM_NUMBERS.has(from)) {

    // Spam filter
    const spam = await isLikelySpam(from)
    if (spam) {
      await supabase.from('lead_activities').insert({
        lead_id: null,
        activity_type: 'call',
        description: `Spam filtered: repeat no-input caller ${from} (3+ in 7 days)`,
        agent: 'System',
        metadata: { direction: 'inbound', from, tag: 'ivr_no_input', spam: true }
      })
      return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
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
      const { data: newLead } = await supabase.from('leads').insert({
        full_name: `Caller (${formatPhone(from)})`,
        phone: from,
        source: 'inbound_ivr_no_input',
        station: 'intake',
        priority: 'normal',
      }).select('id').single()
      noInputLeadId = newLead?.id || null
    }

    // Ensure manifest exists (fire-and-forget)
    if (noInputLeadId) ensureManifestExists(noInputLeadId).catch(err => console.error('[MANIFEST] Failed:', err))

    // Log call (feeds spam counter for future calls)
    await supabase.from('lead_activities').insert({
      lead_id: noInputLeadId,
      activity_type: 'call',
      description: `Inbound call from ${from} — no IVR input, routing to agents`,
      agent: 'System',
      metadata: { direction: 'inbound', from, tag: 'ivr_no_input' }
    })

    // NO auto-text here. If both agents miss, dial-result sends it after 3-5 min.

    // Dial both agents — let dial-result handle the outcome
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(noInputLeadId || '')}&amp;calledNumber=${encodeURIComponent(calledNumber)}&amp;type=no_input" method="POST" timeout="20" callerId="${routing.primary.companyNumber}">
    <Number url="${BASE_URL}/api/ivr/whisper?type=call&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(noInputLeadId || '')}">${routing.primary.phone}</Number>
    <Number url="${BASE_URL}/api/ivr/whisper?type=call&amp;from=${encodeURIComponent(from)}&amp;leadId=${encodeURIComponent(noInputLeadId || '')}">${routing.secondary.phone}</Number>
  </Dial>
</Response>`
    return new NextResponse(twiml, { headers: { 'Content-Type': 'text/xml' } })
  }

  return new NextResponse('<Response><Hangup /></Response>', { headers: { 'Content-Type': 'text/xml' } })
}
