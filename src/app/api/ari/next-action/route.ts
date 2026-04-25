/**
 * Ari Next Action — synthesizes the single concrete next step for a lead.
 *
 * POST /api/ari/next-action
 * Body: { leadId }
 * Returns: {
 *   title: "Call Jackie back about her final decision",
 *   detail: "She said she needed the weekend to talk to her brother",
 *   dateTime: "2026-04-30T11:00:00-05:00",  // or null
 *   dateOnly: false,
 *   priority: "critical" | "high" | "nominal",
 *   cta: "Start Call",
 *   source: "From call on Apr 15 + task scheduled Apr 17"
 * }
 *
 * Grounded in: manifest.ariIntelligence.recommendedActions, pending tasks,
 * recent call transcripts (summary + verbatim quotes), notes, appointment.
 */

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

export async function POST(request: Request) {
  try {
    const { leadId } = (await request.json()) as { leadId?: string }
    if (!leadId) {
      return NextResponse.json({ error: 'leadId required' }, { status: 400 })
    }

    const nowIso = new Date().toISOString()
    const [{ data: lead }, { data: manifestRow }, { data: activities }, { data: nextAppt }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).maybeSingle(),
      supabase.from('manifests').select('manifest').eq('lead_id', leadId).limit(1).maybeSingle(),
      supabase
        .from('lead_activities')
        .select('id, activity_type, description, metadata, created_at, agent')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('appointments')
        .select('*')
        .eq('lead_id', leadId)
        .in('status', ['scheduled', 'confirmed', 'rescheduled'])
        .gte('scheduled_at', nowIso)
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle(),
    ])

    if (!lead) {
      return NextResponse.json({ error: 'lead not found' }, { status: 404 })
    }

    const manifest = manifestRow?.manifest
    const firstName = String(lead.full_name || '').trim().split(/\s+/)[0] || 'the seller'
    // Prefer appointments table (canonical) — fall back to lead.appointment_date
    // for leads that haven't been re-touched since the table was added.
    const canonicalAppointment = nextAppt
      ? { scheduledAt: nextAppt.scheduled_at, type: nextAppt.type, address: nextAppt.address, notes: nextAppt.notes }
      : lead.appointment_date
        ? { scheduledAt: lead.appointment_date, type: 'phone_call', address: null, notes: lead.appointment_notes ?? null }
        : null
    const context = buildContext(lead, manifest, activities ?? [], canonicalAppointment)

    const groqKey = process.env.GROQ_API_KEY
    if (!groqKey) {
      // Fallback: best effort from pure rules
      return NextResponse.json(fallback(lead, manifest, activities ?? []))
    }

    const today = new Date()
    const todayReadable = `${today.toLocaleDateString('en-US', { weekday: 'short' })} ${today.toLocaleDateString('en-US', { month: 'long' })} ${today.getDate()}`
    const todayISO = today.toISOString().slice(0, 10)

    const system = `You are the next-action engine for a Kansas City real estate wholesaling team.
Your job: read the ENTIRE context below — manifest, every transcript summary + quotes, every pending
task, every note, every email — then write a rich, specific next-action brief for the agent.

TODAY: ${todayReadable} (${todayISO}). In the detail passage, format every calendar date as
"Wed April 30th" — short weekday + full month + day with ordinal suffix. The dateTime field
MUST still be strict ISO 8601 with timezone. If the source data has a vague date like
"end of the month" or "around the 28th", resolve it to a concrete day using today as the
anchor. Never leave vague dates in the passage.

Treat this like a briefing memo, not a chat message. The agent is about to pick up the phone; your
job is to tell them exactly what the seller said, when they agreed to reconnect, and what to prep
beforehand. Generic language ruins trust.

# HARD RULES (will be rejected if violated)
1. Title MUST use the lead's FIRST NAME ONLY ("${firstName}") — never the full name. Full names are
   too formal and unnatural. Examples: "Call Jackie back…" not "Call Jackie Daniels back…".
   Use the first name in the detail too when referring to them ("She said…" is also fine — match the
   tone you'd use when talking about them to a coworker).
2. Detail MUST be 2-5 sentences and synthesize from multiple sources when they exist:
   - What the seller SAID (quote or paraphrase with source date)
   - What they AGREED TO (commitment: "will call back Tuesday at 11am")
   - What the AGENT committed to (prep tasks: "send info on Saving KC", "pull tax record", etc.)
   - What's at stake (pain, urgency, deadline)
3. NEVER use: "check on", "check in", "touch base", "follow up" (without a topic), "see how they're
   doing", "reach out", "reconnect", "nurture", "seller's situation", "their situation".
4. If a commitment, date, or deadline exists ANYWHERE in context (task due_date,
   pipeline.appointment.scheduledAt, recommendedActions[].dateTime, a transcript commitment, a note
   mentioning a day/date), surface it EXACTLY with ISO 8601 in dateTime.
5. If the context mentions the agent owes the seller something (send a link, send address, send info,
   confirm price, etc.), list those items in prep_actions as an array of short imperative strings.
   ORDER THEM BY PRIORITY: most time-sensitive / highest-leverage item first. A promised deliverable
   the seller is waiting on beats an internal research task. Pulling comps before a price
   conversation beats a generic "review notes". If two are equal, put the one with the earliest
   implied deadline first.
6. If context is genuinely empty on motivation / price / timeline, that ABSENCE is the next-action
   topic — pick one and say "No X captured yet. This is the discovery call."
7. Source line cites the specific artifacts you pulled from — e.g.,
   "Call Apr 15 transcript + agent note Apr 16 + task due Apr 30".
8. Look FAR into the future for tasks and appointments. A task due 30 days out still counts.

# GOLD STANDARD EXAMPLE (what we want output to feel like)
{
  "title": "Call Jackie back for her final decision",
  "detail": "On the Apr 15 call, Jackie said she needs a couple of weeks to talk it over with her trusted people (brother + pastor). She committed to a callback on Tuesday Apr 30 at 11am to give her final decision. Agent promised to send her info about who Saving KC is before then. She's motivated by the upcoming tax sale and wants a clean exit without a realtor commission eating the proceeds.",
  "dateTime": "2026-04-30T11:00:00-05:00",
  "dateOnly": false,
  "priority": "critical",
  "cta": "Start Call",
  "prep_actions": [
    "Send Saving KC info packet — she is actively waiting on this before Tuesday",
    "Pull most recent tax delinquency amount for the call",
    "Re-read Apr 15 transcript 10 min before dialing"
  ],
  "source": "Call Apr 15 transcript verbatim + task due Apr 30 11am + agent note Apr 15"
}

# ANOTHER GOOD ONE (when there's a live appointment)
{
  "title": "Run Maria's walkthrough tomorrow at 10am",
  "detail": "Walkthrough was confirmed on the Apr 18 call — she'll meet at the property with her daughter. Maria said the roof is the biggest concern and she wants to see our repair numbers in writing. Agent promised a printed scope-of-work sheet on arrival. She mentioned another investor walked it Monday but 'didn't feel right about him'.",
  "dateTime": "2026-04-19T10:00:00-05:00",
  "dateOnly": false,
  "priority": "critical",
  "cta": "Send SMS",
  "prep_actions": ["Print scope-of-work with repair line items", "Text morning-of confirming 10am at the property"],
  "source": "manifest.pipeline.appointment.scheduledAt + call Apr 18 verbatim + agent note Apr 18"
}

# WHEN DATA IS THIN (still be specific)
{
  "title": "Ask Thomas his walkaway number",
  "detail": "No price floor captured yet. The Apr 17 call was brief — he confirmed the address but never named a number. Manifest.situation.priceExpectations is empty. Without this, every offer conversation is blind. Ask: 'How much do you need to walk away with from this deal?'",
  "dateTime": null,
  "dateOnly": false,
  "priority": "high",
  "cta": "Start Call",
  "prep_actions": ["Pull recent comps in Leawood 66206 to back up the ask"],
  "source": "Manifest priceExpectations empty · 1 brief call Apr 17 without price"
}

# BAD (do NOT produce anything like these)
- "Call Thomas Carpenter back to check on the seller's situation" — full name is too formal + forbidden phrase
- "Follow up with Jackie Daniels" — full name + no topic
- "Reach out to Maria Lopez about the property" — full name + forbidden phrase
- Single-sentence detail that ignores transcripts/notes — you failed to read the context

Return STRICT JSON only, no preamble, no code fences:
{
  "title": "...",
  "detail": "... 2-5 sentences ...",
  "dateTime": "ISO 8601 or null",
  "dateOnly": false,
  "priority": "critical" | "high" | "nominal",
  "cta": "Start Call" | "Send SMS" | "Open Task" | "Log Outcome" | "Send Email" | "Log Note",
  "prep_actions": ["..."],
  "source": "..."
}

LEAD CONTEXT:
${context}`

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1200,
        temperature: 0.25,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'Read everything above carefully and write the rich next-action brief. Cite quotes from transcripts or notes when they exist. Include every prep task the agent promised the seller.' },
        ],
      }),
    })

    if (!response.ok) {
      const errText = await response.text()
      console.error('[next-action] Groq error:', response.status, errText)
      return NextResponse.json(fallback(lead, manifest, activities ?? []))
    }

    const data = await response.json()
    const raw = data?.choices?.[0]?.message?.content?.trim() || ''
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch {
      console.error('[next-action] JSON parse failed, raw:', raw.slice(0, 200))
      return NextResponse.json(fallback(lead, manifest, activities ?? []))
    }

    // Vagueness guard: reject outputs that leak banned filler phrases.
    const banned = [
      'check on',
      'check in',
      'touch base',
      "seller's situation",
      "their situation",
      'see how they',
      'reach out',
      'reconnect',
    ]
    const combined = `${parsed.title || ''} ${parsed.detail || ''}`.toLowerCase()
    const hit = banned.find((b) => combined.includes(b))
    if (hit) {
      console.warn('[next-action] vagueness guard caught:', hit, '— retrying with stricter nudge')
      // One retry with a stronger nudge appended
      const retryResp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 500,
          temperature: 0.15,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: 'What is the single most concrete next action?' },
            { role: 'assistant', content: raw },
            {
              role: 'user',
              content:
                `Your previous output contained the banned phrase "${hit}". ` +
                `Rewrite with a specific topic (motivation, price floor, timeline, condition, decision makers, ` +
                `or competition) or an exact commitment from the context. Return JSON only.`,
            },
          ],
        }),
      })
      if (retryResp.ok) {
        try {
          const retryData = await retryResp.json()
          const retryRaw = retryData?.choices?.[0]?.message?.content?.trim() || ''
          const retryParsed = JSON.parse(retryRaw)
          const retryCombined = `${retryParsed.title || ''} ${retryParsed.detail || ''}`.toLowerCase()
          if (!banned.some((b) => retryCombined.includes(b))) {
            parsed = retryParsed
          }
        } catch {
          /* keep original parsed on retry failure */
        }
      }
    }

    // Normalize + guard
    const prepActions: string[] = Array.isArray(parsed.prep_actions)
      ? parsed.prep_actions.map((s: any) => String(s || '').trim()).filter(Boolean).slice(0, 6)
      : []

    // Strip full name → first name in title and detail if the LLM slipped.
    const fullName = String(lead.full_name || '').trim()
    const lastName = fullName.split(/\s+/).slice(1).join(' ')
    function stripFullName(s: string): string {
      if (!fullName || !lastName) return s
      const pattern = new RegExp(`\\b${firstName}\\s+${lastName}(?:['']s)?\\b`, 'gi')
      return s.replace(pattern, (match) => (match.endsWith("'s") || match.endsWith("’s") ? `${firstName}'s` : firstName))
    }

    const result = {
      title: stripFullName(String(parsed.title || '').trim()) || fallback(lead, manifest, activities ?? []).title,
      detail: stripFullName(String(parsed.detail || '').trim()),
      dateTime: typeof parsed.dateTime === 'string' ? parsed.dateTime : null,
      dateOnly: Boolean(parsed.dateOnly),
      priority:
        parsed.priority === 'critical' || parsed.priority === 'high' || parsed.priority === 'nominal'
          ? parsed.priority
          : 'high',
      cta: String(parsed.cta || 'Open Task'),
      prep_actions: prepActions,
      source: String(parsed.source || '').trim() || 'Synthesized from manifest + activity',
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[next-action] error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

// ─── Context builder ────────────────────────────────────────────────────────
// Feeds the LLM a deep, organized dossier. Pulls ALL pending tasks, ALL
// transcripts (with generous per-item budgets), ALL notes/emails/sms,
// agenda recommendations, full situation, agent commitments, etc.
interface CanonicalAppointment {
  scheduledAt: string
  type: string | null
  address: string | null
  notes: string | null
}

function buildContext(lead: any, manifest: any, activities: any[], canonicalAppointment?: CanonicalAppointment | null): string {
  const parts: string[] = []

  // ── Identity ─────────────────────────────────────────────────────────
  parts.push(`## LEAD`)
  parts.push(`Full name: ${lead.full_name || 'Unknown'}`)
  if (lead.phone) parts.push(`Phone: ${lead.phone}`)
  if (lead.email) parts.push(`Email: ${lead.email}`)
  parts.push(`Address: ${[lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || 'n/a'}`)
  if (lead.county) parts.push(`County: ${lead.county}`)
  if (lead.source) parts.push(`Source: ${lead.source}`)
  if (lead.station) parts.push(`Station: ${lead.station}`)
  if (lead.priority) parts.push(`Priority: ${lead.priority}`)
  if (lead.motivation_score != null) parts.push(`Motivation score (0-10): ${lead.motivation_score}`)
  if (lead.seller_situation) parts.push(`Seller situation (lead row): ${truncate(String(lead.seller_situation), 1000)}`)

  // ── Canonical appointment (from appointments table when present) ─────
  // When this is set, treat it as the next action. Pre-render the time in
  // America/Chicago so the LLM doesn't have to do timezone math (it gets
  // it wrong — drops the offset, leaves the digits, ends up off by 5h).
  if (canonicalAppointment?.scheduledAt) {
    const apptDate = new Date(canonicalAppointment.scheduledAt)
    const apptCT = apptDate.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short', month: 'long', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    })
    const ct = new Date(apptDate.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
    const offsetMin = (apptDate.getTime() - ct.getTime()) / 60000
    const offHr = Math.floor(Math.abs(offsetMin) / 60)
    const offMin = Math.abs(offsetMin) % 60
    const sign = offsetMin >= 0 ? '-' : '+'
    const pad = (n: number) => String(n).padStart(2, '0')
    const y = ct.getFullYear(), mo = pad(ct.getMonth() + 1), d = pad(ct.getDate())
    const hh = pad(ct.getHours()), mm = pad(ct.getMinutes()), ss = pad(ct.getSeconds())
    const ctIsoFinal = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${sign}${pad(offHr)}:${pad(offMin)}`
    parts.push(
      `\n## CANONICAL APPOINTMENT (use this as the next action when in the future)`,
      `Local time (Central): ${apptCT} CT`,
      `Strict ISO with CT offset (use this VERBATIM in the dateTime field — do NOT transform): ${ctIsoFinal}`,
    )
    if (canonicalAppointment.type) parts.push(`Type: ${canonicalAppointment.type}`)
    if (canonicalAppointment.address) parts.push(`Location: ${canonicalAppointment.address}`)
    if (canonicalAppointment.notes) {
      parts.push(`Appointment notes: ${truncate(String(canonicalAppointment.notes), 600)}`)
    }
  }

  if (lead.notes) parts.push(`\nCRM NOTES (lead row):\n${truncate(String(lead.notes), 2000)}`)

  if (manifest) {
    parts.push(`\n## PIPELINE & SCHEDULE`)
    // Only include manifest.pipeline.appointment as a fallback when the
    // canonical appointment isn't available — avoids the LLM seeing two
    // appointments and picking the wrong one.
    if (!canonicalAppointment) {
      const appt = manifest.pipeline?.appointment
      if (appt?.scheduledAt) {
        parts.push(
          `Appointment (manifest fallback): ${appt.scheduledAt} · type=${appt.type || '?'} · status=${appt.status || '?'} · location=${appt.location || '?'}${appt.notes ? ' · notes=' + truncate(String(appt.notes), 400) : ''}`
        )
      }
    }

    // ── AI-extracted follow-ups from call analyzer ───────────────────
    // recommendedActions is append-only with no dedup, so it accumulates
    // contradictory entries over time. Filter aggressively before showing
    // to the LLM: when there's a canonical appointment, only show recs
    // scheduled AFTER it (post-appointment follow-ups). When there isn't,
    // keep the most recent 3 only.
    const rec: any[] = manifest.ariIntelligence?.recommendedActions || []
    const cutoffMs = canonicalAppointment ? new Date(canonicalAppointment.scheduledAt).getTime() : 0
    const keep = rec
      .filter(r => {
        if (!canonicalAppointment) return true
        const w = r.when || r.dateTime
        if (!w) return false
        const t = new Date(w).getTime()
        return Number.isFinite(t) && t > cutoffMs
      })
      .slice(0, canonicalAppointment ? 2 : 3)
    if (keep.length) {
      parts.push(`\nFOLLOW-UPS (post-appointment recommendations only):`)
      for (const r of keep) {
        parts.push(`- "${r.action || '?'}" · when=${r.when || r.dateTime || '?'} · why=${truncate(String(r.reason || ''), 250)}`)
      }
    }

    // ── Agenda / next-steps if the manifest carries them ─────────────
    const agenda =
      manifest.pipeline?.nextSteps ||
      manifest.pipeline?.agenda ||
      manifest.situation?.nextSteps ||
      []
    if (Array.isArray(agenda) && agenda.length) {
      parts.push(`\nAGENDA (manifest.pipeline.nextSteps):`)
      for (const a of agenda.slice(0, 8)) {
        if (typeof a === 'string') parts.push(`- ${a}`)
        else parts.push(`- ${JSON.stringify(a).slice(0, 300)}`)
      }
    }

    // ── Agent commitments (things WE promised) ───────────────────────
    const agentCommits =
      manifest.communications?.agentCommitments ||
      manifest.pipeline?.agentPromises ||
      []
    if (Array.isArray(agentCommits) && agentCommits.length) {
      parts.push(`\nAGENT COMMITMENTS (things we promised the seller):`)
      for (const c of agentCommits.slice(0, 8)) {
        parts.push(`- ${typeof c === 'string' ? c : JSON.stringify(c).slice(0, 300)}`)
      }
    }

    // ── Full situation ───────────────────────────────────────────────
    const s = manifest.situation
    if (s) {
      parts.push(`\n## SITUATION`)
      if (s.summary) parts.push(`Summary: ${truncate(String(s.summary), 800)}`)
      if (s.type?.length) parts.push(`Tags: ${s.type.join(', ')}`)
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
      if (s.priceExpectations?.priceFlexibility) parts.push(`Price flexibility: ${s.priceExpectations.priceFlexibility}`)
      if (s.objections?.length) parts.push(`Objections: ${s.objections.join('; ')}`)
      if (s.blockers?.length) parts.push(`Blockers: ${s.blockers.join('; ')}`)
    }

    // ── Owner / decision makers ──────────────────────────────────────
    const o = manifest.owner
    if (o) {
      const bits: string[] = []
      if (o.fullName) bits.push(o.fullName)
      if (o.personalityType) bits.push(`personality: ${o.personalityType}`)
      if (o.contactPreference) bits.push(`prefers: ${o.contactPreference}`)
      if (o.deceased) bits.push('DECEASED')
      if (o.outOfState) bits.push('OUT OF STATE')
      if (o.coOwners?.length) bits.push(`co-owners: ${o.coOwners.join(', ')}`)
      if (o.decisionMakers?.length) bits.push(`decision makers: ${o.decisionMakers.join(', ')}`)
      if (o.influencers?.length) bits.push(`influencers: ${o.influencers.join(', ')}`)
      if (bits.length) parts.push(`\nOWNER: ${bits.join(' | ')}`)
    }

    // ── Property + tax ───────────────────────────────────────────────
    const p = manifest.property
    if (p) {
      const dw = p.dwelling || {}
      const propBits: string[] = []
      if (dw.bedrooms) propBits.push(`${dw.bedrooms}bd`)
      if (dw.bathrooms) propBits.push(`${dw.bathrooms}ba`)
      if (dw.sqft) propBits.push(`${dw.sqft} sf`)
      if (dw.yearBuilt) propBits.push(`built ${dw.yearBuilt}`)
      if (dw.propertyType) propBits.push(dw.propertyType)
      if (propBits.length) parts.push(`Property: ${propBits.join(' · ')}`)
      if (p.vacant) parts.push('Property is VACANT')
      if (p.condition?.overall) parts.push(`Condition: ${p.condition.overall}${p.condition.notes ? ' — ' + truncate(String(p.condition.notes), 300) : ''}`)
      const tax = p.taxCollector || {}
      if (tax.totalOwed) parts.push(`Taxes owed: $${Number(tax.totalOwed).toLocaleString()}`)
      if (tax.delinquentAmount) parts.push(`Tax delinquent: $${Number(tax.delinquentAmount).toLocaleString()}`)
      if (tax.yearsDelinquent) parts.push(`Years delinquent: ${tax.yearsDelinquent}`)
      if (tax.firstDelinquentYear) parts.push(`Delinquent since: ${tax.firstDelinquentYear}`)
    }

    // ── Flags ────────────────────────────────────────────────────────
    if (manifest.flags?.redFlags?.length) parts.push(`Red flags: ${manifest.flags.redFlags.join(', ')}`)
    if (manifest.flags?.opportunityFlags?.length) parts.push(`Opportunity flags: ${manifest.flags.opportunityFlags.join(', ')}`)

    // ── Last briefing paragraphs ─────────────────────────────────────
    const briefing = manifest.ariIntelligence?.lastBriefing
    if (briefing) {
      parts.push(`\n## LAST BRIEFING`)
      if (briefing.situation) parts.push(`Situation: ${truncate(String(briefing.situation), 600)}`)
      if (briefing.motivation) parts.push(`Motivation: ${truncate(String(briefing.motivation), 600)}`)
      if (briefing.strategy) parts.push(`Strategy: ${truncate(String(briefing.strategy), 600)}`)
    }

    // ── ALL transcripts, rich detail each ────────────────────────────
    const transcripts: any[] = manifest.communications?.transcripts || []
    if (transcripts.length) {
      parts.push(`\n## ALL CALL TRANSCRIPTS (latest first, ${transcripts.length} total)`)
      for (const t of transcripts.slice(0, 8)) {
        parts.push(`\n--- Call ${t.date || '?'} · agent=${t.agent || '?'} · duration=${t.durationSeconds || '?'}s ---`)
        if (t.aiSummary) parts.push(`Summary:\n${truncate(String(t.aiSummary), 1200)}`)
        if (t.agentNotes) parts.push(`Agent notes:\n${truncate(String(t.agentNotes), 800)}`)
        const ex = t.extractedData || {}
        if (ex.sentiment) parts.push(`Sentiment: ${ex.sentiment}`)
        if (ex.rapportLevel) parts.push(`Rapport: ${ex.rapportLevel}`)
        if (ex.motivationScore != null) parts.push(`Motivation score: ${ex.motivationScore}`)
        if (ex.nextSteps?.length) parts.push(`Next steps: ${ex.nextSteps.map((s: string) => `"${s}"`).join(' | ')}`)
        if (ex.commitments?.length) parts.push(`Commitments: ${ex.commitments.map((s: string) => `"${s}"`).join(' | ')}`)
        if (ex.followUpAction) parts.push(`Follow-up action: ${ex.followUpAction}`)
        if (ex.followUpDateTime) parts.push(`Follow-up datetime: ${ex.followUpDateTime}`)
        if (ex.appointmentDateTime) parts.push(`Appointment datetime: ${ex.appointmentDateTime}`)
        if (ex.agentPromises?.length) parts.push(`Agent promised: ${ex.agentPromises.map((s: string) => `"${s}"`).join(' | ')}`)
        if (ex.objectionsRaised?.length) parts.push(`Objections raised: ${ex.objectionsRaised.join('; ')}`)
        if (ex.concessionSignals?.length) parts.push(`Concession signals: ${ex.concessionSignals.join('; ')}`)
        if (ex.keyLeverage?.length) parts.push(`Key leverage: ${ex.keyLeverage.join('; ')}`)
        if (ex.painPoints?.length) parts.push(`Pain points: ${ex.painPoints.join('; ')}`)
        if (ex.verbatimQuotes?.length) {
          parts.push(`Verbatim quotes:`)
          for (const q of ex.verbatimQuotes.slice(0, 6)) {
            parts.push(`  "${truncate(String(q), 240)}"`)
          }
        }
      }
    }
  }

  // ── Email activities (full content if short) ─────────────────────────
  const emails = activities.filter((a: any) => a.activity_type === 'email')
  if (emails.length) {
    parts.push(`\n## EMAILS (${emails.length} on record, latest first)`)
    for (const e of emails.slice(0, 6)) {
      const when = new Date(e.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const md = e.metadata || {}
      parts.push(`- [${when}] ${md.direction || ''} ${md.subject ? 'subj="' + md.subject + '" ' : ''}${truncate(String(e.description || ''), 600)}`)
    }
  }

  // ── Notes (full text each) ──────────────────────────────────────────
  const notes = activities.filter((a: any) =>
    ['note', 'agent_note'].includes(a.activity_type)
  )
  if (notes.length) {
    parts.push(`\n## AGENT NOTES (${notes.length} on record, latest first)`)
    for (const n of notes.slice(0, 12)) {
      const when = new Date(n.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      parts.push(`- [${when}] by ${n.agent || '?'}: ${truncate(String(n.description || ''), 600)}`)
    }
  }

  // ── SMS activities (direction + content) ────────────────────────────
  const sms = activities.filter((a: any) => a.activity_type === 'sms')
  if (sms.length) {
    parts.push(`\n## SMS (${sms.length} on record, latest first)`)
    for (const s of sms.slice(0, 10)) {
      const when = new Date(s.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const md = s.metadata || {}
      parts.push(`- [${when}] ${md.direction || ''}: ${truncate(String(s.description || ''), 300)}`)
    }
  }

  // ── Call activity summaries (dispositions, durations) ───────────────
  const calls = activities.filter((a: any) => a.activity_type === 'call')
  if (calls.length) {
    parts.push(`\n## CALL ACTIVITY LOG (${calls.length} on record, latest first)`)
    for (const c of calls.slice(0, 10)) {
      const when = new Date(c.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const md = c.metadata || {}
      parts.push(`- [${when}] ${md.disposition || md.direction || ''} ${md.duration ? md.duration + 's' : ''}: ${truncate(String(c.description || ''), 400)}`)
    }
  }

  // ── ALL pending tasks (no date window cap) ──────────────────────────
  const tasks = activities.filter(
    (a: any) =>
      a.activity_type === 'task' &&
      a.metadata?.status !== 'completed' &&
      a.metadata?.status !== 'done'
  )
  if (tasks.length) {
    parts.push(`\n## PENDING TASKS (${tasks.length} open, all dates)`)
    for (const t of tasks
      .slice()
      .sort((a: any, b: any) =>
        new Date(a.metadata?.due_date || 0).getTime() -
        new Date(b.metadata?.due_date || 0).getTime()
      )
      .slice(0, 12)) {
      const md = t.metadata || {}
      parts.push(
        `- "${t.description || '(no title)'}" · due=${md.due_date || '?'} · task_type=${md.task_type || '?'} · assigned_to=${md.assigned_to || '?'} · notes=${md.notes ? truncate(String(md.notes), 400) : '-'}`
      )
    }
  }

  parts.push(`\n## NOW: ${new Date().toISOString()} (local: ${new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' })})`)
  return parts.join('\n')
}

// ─── Deterministic fallback when LLM isn't available ────────────────────────
function fallback(lead: any, manifest: any, activities: any[]): any {
  const name = lead.full_name || 'this lead'

  // Past-due appointment?
  const appt = manifest?.pipeline?.appointment
  if (appt?.scheduledAt && new Date(appt.scheduledAt).getTime() < Date.now()) {
    return {
      title: `Log ${name}'s appointment outcome`,
      detail: 'Capture what happened on the walkthrough.',
      dateTime: appt.scheduledAt,
      dateOnly: false,
      priority: 'critical',
      cta: 'Log Outcome',
      source: `Appointment scheduled ${appt.scheduledAt}`,
    }
  }

  // Pending task — soonest wins
  const nextTask = activities
    .filter((a: any) => a.activity_type === 'task' && a.metadata?.due_date && a.metadata?.status !== 'completed')
    .sort((a: any, b: any) => new Date(a.metadata.due_date).getTime() - new Date(b.metadata.due_date).getTime())[0]
  if (nextTask) {
    return {
      title: `${nextTask.description || 'Task'} — ${name}`,
      detail: nextTask.metadata?.notes ? String(nextTask.metadata.notes).slice(0, 200) : 'Scheduled task.',
      dateTime: nextTask.metadata.due_date,
      dateOnly: false,
      priority: 'high',
      cta: 'Open Task',
      source: `Task due ${nextTask.metadata.due_date}`,
    }
  }

  return {
    title: `Stand by on ${name}`,
    detail: 'No pending tasks, appointments, or commitments.',
    dateTime: null,
    dateOnly: false,
    priority: 'nominal',
    cta: 'Log Note',
    source: 'No signals on record',
  }
}

function truncate(s: string, max: number): string {
  if (!s) return ''
  return s.length <= max ? s : s.slice(0, max) + '…'
}
