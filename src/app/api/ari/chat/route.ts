/**
 * Ari Chat — conversational Q&A grounded in the lead's manifest.
 *
 * POST /api/ari/chat
 * Body: { leadId: string, messages: Array<{ role: 'user' | 'assistant', content: string }> }
 * Returns: { reply: string }
 */

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(request: Request) {
  try {
    const { leadId, messages } = (await request.json()) as {
      leadId?: string
      messages?: ChatMessage[]
    }

    if (!leadId || !Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'leadId and messages required' }, { status: 400 })
    }

    const [{ data: lead }, { data: manifestRow }, { data: activities }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).maybeSingle(),
      supabase.from('manifests').select('manifest').eq('lead_id', leadId).limit(1).maybeSingle(),
      supabase
        .from('lead_activities')
        .select('activity_type, description, metadata, created_at')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(20),
    ])

    const context = buildContext(lead, manifestRow?.manifest, activities ?? [])
    const groqKey = process.env.GROQ_API_KEY
    const openRouterKey = process.env.OPENROUTER_API_KEY

    if (!groqKey && !openRouterKey) {
      return NextResponse.json({
        reply: 'Ari is offline - no LLM API key configured (GROQ_API_KEY or OPENROUTER_API_KEY).',
      })
    }

    const systemPrompt = `You are Ari, an AI assistant for a Kansas City real estate wholesaling team (Saving KC).
You help Ernest and Casey understand leads, plan next moves, and figure out which discovery questions still matter.
The manifest below is the source of truth for this lead. Ground every answer in it. If a data point isn't there, say so - don't invent.
Be concise (2-4 sentences by default). Lead with the answer, not a recap of the question.
When asked what to ask next, reference the Appointment Setting Framework pillars: Motivation, Timeline, Price, Condition, Favorite-or-Fool.

LEAD CONTEXT:
${context}`

    // Prefer Groq (generous free tier, fast). Fall back to OpenRouter.
    let response: Response
    if (groqKey) {
      response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 500,
          temperature: 0.3,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      })
    } else {
      response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${openRouterKey!}`,
          'HTTP-Referer': 'https://crm.savingkc.com',
          'X-Title': 'Saving KC CRM - Ari Chat',
        },
        body: JSON.stringify({
          model: 'anthropic/claude-3.5-haiku',
          max_tokens: 140,
          messages: [
            { role: 'system', content: systemPrompt },
            ...messages.map((m) => ({ role: m.role, content: m.content })),
          ],
        }),
      })
    }

    if (!response.ok) {
      const errText = await response.text()
      console.error('[ari-chat] API error:', response.status, errText)
      // Surface the real reason to the UI so we can tell when it's broken.
      const hint =
        response.status === 401
          ? 'API key is invalid or missing in this environment.'
          : response.status === 402
            ? 'Provider is out of credits.'
            : response.status === 429
              ? 'Rate limited - try again in a moment.'
              : 'Temporary provider error.'
      return NextResponse.json(
        { error: `Ari is unavailable (${response.status}). ${hint}` },
        { status: 502 }
      )
    }

    const data = await response.json()
    const reply =
      data?.choices?.[0]?.message?.content?.trim() ||
      "I don't have enough context to answer that yet."
    return NextResponse.json({ reply })
  } catch (err) {
    console.error('[ari-chat] error:', err)
    return NextResponse.json({ error: 'Chat failed' }, { status: 500 })
  }
}

function buildContext(lead: any, manifest: any, activities: any[]): string {
  // The manifest is the source of truth. We fall back to the lead row only for
  // identity fields that wouldn't be in the manifest (raw contact data, etc).
  const parts: string[] = []

  if (lead) {
    parts.push('## IDENTITY')
    parts.push(`Name: ${lead.full_name || 'Unknown'}`)
    parts.push(`Phone: ${lead.phone || 'n/a'}`)
    parts.push(`Email: ${lead.email || 'n/a'}`)
    parts.push(`Address: ${[lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || 'n/a'}`)
    parts.push(`County: ${lead.county || 'n/a'}`)
    parts.push(`Source: ${lead.source || 'n/a'}`)
    parts.push(`Station: ${lead.station || 'n/a'}`)
    parts.push(`Priority: ${lead.priority || 'n/a'}`)
    if (lead.motivation_score != null) parts.push(`Motivation score (lead row): ${lead.motivation_score}`)
    if (lead.seller_situation) parts.push(`Seller situation (lead row): ${truncate(lead.seller_situation, 400)}`)
    if (lead.notes) parts.push(`CRM notes: ${truncate(lead.notes, 800)}`)
  }

  if (manifest) {
    parts.push('\n## MANIFEST (source of truth)')
    if (manifest.currentStation) parts.push(`Station: ${manifest.currentStation}`)
    if (manifest.priority) parts.push(`Priority: ${manifest.priority}`)
    if (manifest.tier) parts.push(`Tier: ${manifest.tier}`)
    if (manifest.qualificationScore != null) parts.push(`Qualification score: ${manifest.qualificationScore}`)

    // Owner / decision makers
    if (manifest.owner) {
      const o = manifest.owner
      const bits: string[] = []
      if (o.fullName) bits.push(o.fullName)
      if (o.personalityType) bits.push(`personality: ${o.personalityType}`)
      if (o.contactPreference) bits.push(`prefers: ${o.contactPreference}`)
      if (o.deceased) bits.push('DECEASED')
      if (o.outOfState) bits.push('OUT OF STATE')
      if (o.coOwners?.length) bits.push(`co-owners: ${o.coOwners.join(', ')}`)
      if (o.decisionMakers?.length) bits.push(`decision makers: ${o.decisionMakers.join(', ')}`)
      if (o.influencers?.length) bits.push(`influencers: ${o.influencers.join(', ')}`)
      if (bits.length) parts.push(`Owner: ${bits.join(' | ')}`)
    }

    // Situation
    const s = manifest.situation
    if (s) {
      if (s.summary) parts.push(`Situation summary: ${truncate(s.summary, 500)}`)
      if (s.type?.length) parts.push(`Situation tags: ${s.type.join(', ')}`)
      if (s.motivation?.primary) parts.push(`Primary motivation: ${s.motivation.primary}`)
      if (s.motivation?.urgencyLevel) parts.push(`Urgency: ${s.motivation.urgencyLevel}`)
      if (s.motivation?.signals?.length) parts.push(`Motivation signals: ${s.motivation.signals.join('; ')}`)
      if (s.motivation?.secondary?.length) parts.push(`Secondary motivations: ${s.motivation.secondary.join('; ')}`)
      if (s.timeline?.preferredClosing) parts.push(`Preferred closing: ${s.timeline.preferredClosing}`)
      if (s.timeline?.sellerDeadline) parts.push(`Seller deadline: ${s.timeline.sellerDeadline}`)
      if (s.timeline?.lifeEventType) parts.push(`Life event: ${s.timeline.lifeEventType}`)
      if (s.timeline?.flexibility) parts.push(`Timeline flexibility: ${s.timeline.flexibility}`)
      if (s.priceExpectations?.sellerAsking) parts.push(`Seller asking: $${s.priceExpectations.sellerAsking}`)
      if (s.priceExpectations?.sellerFloor) parts.push(`Seller floor: $${s.priceExpectations.sellerFloor}`)
      if (s.priceExpectations?.minimumAcceptable) parts.push(`Minimum acceptable: $${s.priceExpectations.minimumAcceptable}`)
      if (s.priceExpectations?.priceFlexibility) parts.push(`Price flexibility: ${s.priceExpectations.priceFlexibility}`)
      if (s.objections?.length) parts.push(`Objections: ${s.objections.join('; ')}`)
      if (s.blockers?.length) parts.push(`Blockers: ${s.blockers.join('; ')}`)
    }

    // Property
    const p = manifest.property
    if (p) {
      const pBits: string[] = []
      const d = p.dwelling || {}
      if (d.bedrooms) pBits.push(`${d.bedrooms}bd`)
      if (d.bathrooms) pBits.push(`${d.bathrooms}ba`)
      if (d.sqft) pBits.push(`${d.sqft.toLocaleString()} sf`)
      if (d.yearBuilt) pBits.push(`built ${d.yearBuilt}`)
      if (d.propertyType) pBits.push(d.propertyType)
      if (pBits.length) parts.push(`Property: ${pBits.join(' · ')}`)
      if (p.vacant) parts.push('Property is VACANT')
      if (p.occupancy) parts.push(`Occupancy: ${p.occupancy}`)
      if (p.condition?.overall) parts.push(`Condition: ${p.condition.overall}`)
      if (p.condition?.notes) parts.push(`Condition notes: ${truncate(p.condition.notes, 300)}`)

      if (p.assessment?.appraisedTotal || p.assessment?.totalValue) {
        parts.push(`Appraised: $${(p.assessment.appraisedTotal || p.assessment.totalValue).toLocaleString()}`)
      }
      if (p.taxCollector?.totalOwed) parts.push(`Tax owed: $${Number(p.taxCollector.totalOwed).toLocaleString()}`)
      if (p.taxCollector?.delinquentAmount) parts.push(`Tax delinquent: $${Number(p.taxCollector.delinquentAmount).toLocaleString()}`)
      if (p.taxCollector?.yearsDelinquent) parts.push(`Years delinquent: ${p.taxCollector.yearsDelinquent}`)
    }

    // Financials
    const fin = manifest.financials
    if (fin) {
      const finBits: string[] = []
      if (fin.arv) finBits.push(`ARV $${Number(fin.arv).toLocaleString()}`)
      if (fin.as_is_value) finBits.push(`as-is $${Number(fin.as_is_value).toLocaleString()}`)
      if (fin.repair_estimate) finBits.push(`repairs $${Number(fin.repair_estimate).toLocaleString()}`)
      if (fin.mortgage_balance) finBits.push(`mortgage $${Number(fin.mortgage_balance).toLocaleString()}`)
      if (fin.back_taxes) finBits.push(`back taxes $${Number(fin.back_taxes).toLocaleString()}`)
      if (fin.offer_amount) finBits.push(`offer $${Number(fin.offer_amount).toLocaleString()}`)
      if (fin.equity) finBits.push(`equity $${Number(fin.equity).toLocaleString()}`)
      if (finBits.length) parts.push(`Financials: ${finBits.join(', ')}`)
    }

    // Flags
    if (manifest.flags?.redFlags?.length) parts.push(`Red flags: ${manifest.flags.redFlags.join(', ')}`)
    if (manifest.flags?.opportunityFlags?.length) parts.push(`Opportunity flags: ${manifest.flags.opportunityFlags.join(', ')}`)

    // Last briefing
    const briefing = manifest.ariIntelligence?.lastBriefing
    if (briefing) {
      if (briefing.situation) parts.push(`Last briefing situation: ${truncate(briefing.situation, 300)}`)
      if (briefing.motivation) parts.push(`Last briefing motivation: ${truncate(briefing.motivation, 300)}`)
      if (briefing.strategy) parts.push(`Last briefing strategy: ${truncate(briefing.strategy, 300)}`)
    }

    // Call transcripts (trim heavily)
    const transcripts: any[] = manifest.communications?.transcripts || []
    if (transcripts.length) {
      parts.push('\n## RECENT CALLS (from manifest)')
      for (const t of transcripts.slice(0, 3)) {
        const when = t.date ? new Date(t.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '?'
        if (t.aiSummary) parts.push(`[${when}] Summary: ${truncate(t.aiSummary, 400)}`)
        const ex = t.extractedData
        if (ex?.sentiment || ex?.rapportLevel) {
          parts.push(`  rapport: ${ex.rapportLevel || 'n/a'} · sentiment: ${ex.sentiment || 'n/a'}`)
        }
        if (ex?.verbatimQuotes?.length) {
          parts.push(`  quotes: "${ex.verbatimQuotes.slice(0, 2).map((q: string) => truncate(q, 140)).join('" | "')}"`)
        }
        if (ex?.objectionsRaised?.length) parts.push(`  objections: ${ex.objectionsRaised.slice(0, 3).join('; ')}`)
        if (ex?.concessionSignals?.length) parts.push(`  concessions: ${ex.concessionSignals.slice(0, 3).join('; ')}`)
      }
    }

    // Booking
    if (manifest.booking?.scheduledDate) {
      parts.push(`Booking: ${manifest.booking.scheduledDate} at ${manifest.booking.scheduledTime || 'n/a'} (${manifest.booking.type || 'n/a'})`)
    }
  } else {
    parts.push('\n## MANIFEST: none yet — answer from the lead row + activity only.')
  }

  if (activities.length > 0) {
    parts.push('\n## RECENT ACTIVITY LOG')
    for (const a of activities.slice(0, 10)) {
      const when = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const desc = a.description ? truncate(a.description, 200) : ''
      parts.push(`- [${when}] ${a.activity_type}${desc ? ': ' + desc : ''}`)
    }
  }

  return parts.join('\n')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + '…'
}
