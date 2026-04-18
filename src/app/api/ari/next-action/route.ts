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
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const { leadId } = (await request.json()) as { leadId?: string }
    if (!leadId) {
      return NextResponse.json({ error: 'leadId required' }, { status: 400 })
    }

    const [{ data: lead }, { data: manifestRow }, { data: activities }] = await Promise.all([
      supabase.from('leads').select('*').eq('id', leadId).maybeSingle(),
      supabase.from('manifests').select('manifest').eq('lead_id', leadId).limit(1).maybeSingle(),
      supabase
        .from('lead_activities')
        .select('id, activity_type, description, metadata, created_at, agent')
        .eq('lead_id', leadId)
        .order('created_at', { ascending: false })
        .limit(25),
    ])

    if (!lead) {
      return NextResponse.json({ error: 'lead not found' }, { status: 404 })
    }

    const manifest = manifestRow?.manifest
    const context = buildContext(lead, manifest, activities ?? [])

    const groqKey = process.env.GROQ_API_KEY
    if (!groqKey) {
      // Fallback: best effort from pure rules
      return NextResponse.json(fallback(lead, manifest, activities ?? []))
    }

    const system = `You are an AI assistant for a Kansas City real estate wholesaling team.
Based on the lead context below, produce the SINGLE most concrete next action the agent should take.

Rules:
- Be specific. Never say "follow up" — say "Call [Name] back about [topic]".
- If a date/time is known or inferable, use it. Return the explicit datetime as ISO 8601 if found.
- Include WHY briefly in the detail (what they said, what the task notes said).
- Ground everything in the provided context. If a fact isn't there, don't invent it.
- Cite the source in one short line.

Return STRICT JSON only, no preamble:
{
  "title": "Call Jackie Daniels back about her final decision",
  "detail": "She said she needed the weekend to talk to her brother about the offer",
  "dateTime": "2026-04-30T11:00:00-05:00" | null,
  "dateOnly": false,
  "priority": "critical" | "high" | "nominal",
  "cta": "Start Call" | "Send SMS" | "Open Task" | "Log Outcome" | "Send Email" | "Log Note",
  "source": "From call on Apr 15 + task due Apr 30"
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
        max_tokens: 500,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'What is the single most concrete next action?' },
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

    // Normalize + guard
    const result = {
      title: String(parsed.title || '').trim() || fallback(lead, manifest, activities ?? []).title,
      detail: String(parsed.detail || '').trim(),
      dateTime: typeof parsed.dateTime === 'string' ? parsed.dateTime : null,
      dateOnly: Boolean(parsed.dateOnly),
      priority:
        parsed.priority === 'critical' || parsed.priority === 'high' || parsed.priority === 'nominal'
          ? parsed.priority
          : 'high',
      cta: String(parsed.cta || 'Open Task'),
      source: String(parsed.source || '').trim() || 'Synthesized from manifest + activity',
    }

    return NextResponse.json(result)
  } catch (err) {
    console.error('[next-action] error:', err)
    return NextResponse.json({ error: 'failed' }, { status: 500 })
  }
}

// ─── Context builder ────────────────────────────────────────────────────────
function buildContext(lead: any, manifest: any, activities: any[]): string {
  const parts: string[] = []
  parts.push(`## LEAD`)
  parts.push(`Name: ${lead.full_name || 'Unknown'}`)
  parts.push(`Phone: ${lead.phone || 'n/a'}`)
  parts.push(`Email: ${lead.email || 'n/a'}`)
  parts.push(`Address: ${[lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || 'n/a'}`)
  parts.push(`Station: ${lead.station || 'n/a'}`)
  parts.push(`Priority: ${lead.priority || 'n/a'}`)
  if (lead.notes) parts.push(`CRM notes: ${truncate(String(lead.notes), 600)}`)

  if (manifest) {
    parts.push(`\n## MANIFEST PIPELINE`)
    const appt = manifest.pipeline?.appointment
    if (appt?.scheduledAt) {
      parts.push(`Appointment scheduled: ${appt.scheduledAt} · type: ${appt.type || '?'} · status: ${appt.status || '?'} · location: ${appt.location || '?'}`)
    }

    const rec = manifest.ariIntelligence?.recommendedActions || []
    if (rec.length) {
      parts.push(`\n## AI RECOMMENDED ACTIONS`)
      for (const r of rec.slice(0, 5)) {
        parts.push(`- action: "${r.action || '?'}" · dateTime: ${r.dateTime || '?'} · reason: ${r.reason || '?'}`)
      }
    }

    const s = manifest.situation
    if (s) {
      parts.push(`\n## SITUATION`)
      if (s.summary) parts.push(`Summary: ${truncate(s.summary, 400)}`)
      if (s.motivation?.primary) parts.push(`Primary motivation: ${s.motivation.primary}`)
      if (s.motivation?.urgencyLevel) parts.push(`Urgency: ${s.motivation.urgencyLevel}`)
      if (s.timeline?.sellerDeadline) parts.push(`Seller deadline: ${s.timeline.sellerDeadline}`)
      if (s.timeline?.preferredClosing) parts.push(`Preferred closing: ${s.timeline.preferredClosing}`)
      if (s.priceExpectations?.sellerFloor) parts.push(`Seller floor: $${s.priceExpectations.sellerFloor}`)
      if (s.objections?.length) parts.push(`Objections: ${s.objections.join('; ')}`)
      if (s.blockers?.length) parts.push(`Blockers: ${s.blockers.join('; ')}`)
    }

    const transcripts = manifest.communications?.transcripts || []
    if (transcripts.length) {
      parts.push(`\n## RECENT CALLS (latest first)`)
      for (const t of transcripts.slice(0, 3)) {
        parts.push(`--- Call ${t.date || '?'} ---`)
        if (t.aiSummary) parts.push(`Summary: ${truncate(t.aiSummary, 500)}`)
        const ex = t.extractedData || {}
        if (ex.nextSteps?.length) parts.push(`Next steps: ${ex.nextSteps.slice(0, 3).join(' | ')}`)
        if (ex.commitments?.length) parts.push(`Commitments: ${ex.commitments.slice(0, 3).join(' | ')}`)
        if (ex.followUpAction) parts.push(`Follow-up: ${ex.followUpAction}`)
        if (ex.followUpDateTime) parts.push(`Follow-up time: ${ex.followUpDateTime}`)
        if (ex.appointmentDateTime) parts.push(`Appointment time: ${ex.appointmentDateTime}`)
        if (ex.verbatimQuotes?.length) {
          parts.push(`Quotes: ${ex.verbatimQuotes.slice(0, 3).map((q: string) => `"${truncate(q, 140)}"`).join(' | ')}`)
        }
      }
    }
  }

  // Pending tasks
  const tasks = activities.filter((a: any) => a.activity_type === 'task')
  if (tasks.length) {
    parts.push(`\n## PENDING TASKS`)
    for (const t of tasks.slice(0, 5)) {
      const md = t.metadata || {}
      parts.push(`- ${t.description || '(no title)'} · due: ${md.due_date || '?'} · status: ${md.status || '?'} · notes: ${md.notes ? truncate(String(md.notes), 200) : '-'}`)
    }
  }

  // Recent activity (calls, sms, notes, emails)
  const touches = activities.filter((a: any) =>
    ['call', 'sms', 'email', 'note', 'agent_note'].includes(a.activity_type)
  )
  if (touches.length) {
    parts.push(`\n## RECENT ACTIVITY`)
    for (const a of touches.slice(0, 8)) {
      const when = new Date(a.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      parts.push(`- [${when}] ${a.activity_type}: ${truncate(a.description || '', 250)}`)
    }
  }

  parts.push(`\n## NOW: ${new Date().toISOString()}`)
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
