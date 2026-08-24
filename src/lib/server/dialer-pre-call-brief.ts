import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import type {
  DialerPreCallBrief,
  DialerPreCallEvidence,
  DialerPreCallObjective,
} from '@/lib/dialer-pre-call-brief'
import { communicationActivitySummary } from '@/lib/operating-model/conversation-presentation'
import { readConversationTimeline } from '@/lib/server/conversation-read-model'
import { DialerSessionError, getDialerSession } from '@/lib/server/dialer-session-engine'
import { listWorkItems, type WorkItem } from '@/lib/server/work-items'
import { supabase } from '@/lib/supabase-lazy'

const LEAD_SELECT = 'id,full_name,property_address,city,state,zip,station,priority,motivation_score,property_condition,asking_price,opportunity_score,classification'
const BRIEFING_SELECT = 'situation,motivation,strategy,generated_at,prompt_version,source_revision'
const BRIEFING_JOB_SELECT = 'status,revision'
const APPOINTMENT_SELECT = 'id,scheduled_at,type,status,notes'

function cleanText(value: unknown, max = 280): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().replace(/\s+/g, ' ').slice(0, max) : null
}

function money(value: unknown): string | null {
  const amount = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(amount) && amount > 0
    ? amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : null
}

function dateValue(value: string | null | undefined): number {
  if (!value) return Number.POSITIVE_INFINITY
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY
}

function objective(workItems: WorkItem[], appointment: Record<string, unknown> | null): DialerPreCallObjective | null {
  const primary = workItems.find((item) => item.primaryNextAction) ?? workItems[0] ?? null
  const appointmentAt = cleanText(appointment?.scheduled_at)
  if (appointmentAt && (!primary || dateValue(appointmentAt) < dateValue(primary.dueAt))) {
    return {
      title: `Prepare for ${cleanText(appointment?.type)?.replace(/_/g, ' ') || 'appointment'}`,
      description: cleanText(appointment?.notes, 500),
      dueAt: appointmentAt,
      kind: 'appointment',
      source: 'appointment',
    }
  }
  return primary ? {
    title: cleanText(primary.title, 200) || 'Complete the next action',
    description: cleanText(primary.description, 500),
    dueAt: primary.dueAt,
    kind: primary.kind,
    source: 'work_item',
  } : null
}

function evidenceSummary(item: Awaited<ReturnType<typeof readConversationTimeline>>['items'][number]): string {
  if (item.kind === 'call' || item.kind === 'message') return cleanText(communicationActivitySummary(item), 220) || 'Communication activity'
  if (item.kind === 'note') return cleanText(item.description, 220) || 'Internal note'
  return cleanText(item.description, 220) || 'Status update'
}

function questions(lead: Record<string, unknown>, hasObjective: boolean, coOwners: string[]): string[] {
  const items: string[] = []
  if (!money(lead.asking_price)) items.push('What price would make selling worthwhile?')
  if (typeof lead.motivation_score !== 'number') items.push('What changed that made now the right time to talk?')
  if (!cleanText(lead.property_condition)) items.push('What repairs or updates does the property need?')
  if (coOwners.length) items.push('Who else needs to approve a sale?')
  if (!hasObjective) items.push('What exact next step and date can we agree on?')
  return items.slice(0, 3)
}

function facts(lead: Record<string, unknown>): Array<{ label: string; value: string }> {
  const rows: Array<{ label: string; value: string } | null> = [
    typeof lead.motivation_score === 'number' ? { label: 'Motivation', value: `${lead.motivation_score}/10` } : null,
    cleanText(lead.property_condition) ? { label: 'Condition', value: cleanText(lead.property_condition)!.replace(/_/g, ' ') } : null,
    money(lead.asking_price) ? { label: 'Seller asking', value: money(lead.asking_price)! } : null,
    typeof lead.opportunity_score === 'number' ? { label: 'Opportunity', value: `${lead.opportunity_score}/100` } : null,
    cleanText(lead.classification) ? { label: 'Classification', value: cleanText(lead.classification)!.replace(/_/g, ' ') } : null,
  ]
  return rows.filter((row): row is { label: string; value: string } => row !== null).slice(0, 4)
}

export async function getDialerPreCallBrief(actor: AuthenticatedActor, sessionId: string): Promise<DialerPreCallBrief> {
  const session = await getDialerSession(actor, sessionId)
  if (!session.currentLeadId) throw new DialerSessionError('session_has_no_current_lead', 409, 'This calling session has no current contact')
  const leadId = session.currentLeadId
  const nowIso = new Date().toISOString()

  const [leadResult, briefingResult, briefingJobResult, timeline, workItems, appointmentResult, coOwnerResult] = await Promise.all([
    supabase.from('leads').select(LEAD_SELECT).eq('id', leadId).maybeSingle(),
    supabase.from('briefings').select(BRIEFING_SELECT).eq('lead_id', leadId).eq('is_current', true).order('generated_at', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('crm_briefing_jobs').select(BRIEFING_JOB_SELECT).eq('lead_id', leadId).maybeSingle(),
    readConversationTimeline({ threadId: leadId, limit: 20 }),
    listWorkItems({ leadId, statuses: ['pending', 'blocked'], limit: 10 }),
    supabase.from('appointments').select(APPOINTMENT_SELECT).eq('lead_id', leadId).in('status', ['scheduled', 'confirmed', 'rescheduled']).gte('scheduled_at', nowIso).order('scheduled_at', { ascending: true }).limit(1).maybeSingle(),
    supabase.from('lead_co_owners').select('name').eq('lead_id', leadId).order('created_at', { ascending: true }).limit(10),
  ])
  const firstError = leadResult.error || briefingResult.error || briefingJobResult.error || appointmentResult.error || coOwnerResult.error
  if (firstError) throw new DialerSessionError('pre_call_brief_unavailable', 503, 'Pre-call brief is unavailable')
  if (!leadResult.data) throw new DialerSessionError('lead_not_found', 404, 'Current contact was not found')

  const lead = leadResult.data as Record<string, unknown>
  const appointment = appointmentResult.data as Record<string, unknown> | null
  const nextObjective = objective(workItems, appointment)
  const coOwners = (coOwnerResult.data || []).flatMap((row) => cleanText(row.name, 120) ? [cleanText(row.name, 120)!] : [])
  const recentEvidence: DialerPreCallEvidence[] = timeline.items
    .filter((item) => item.kind !== 'task')
    .slice(0, 4)
    .map((item) => ({
      id: item.id,
      kind: item.kind === 'task' ? 'status' : item.kind,
      direction: item.direction,
      summary: evidenceSummary(item),
      createdAt: item.created_at,
    }))

  const briefing = briefingResult.data as Record<string, unknown> | null
  const briefingAt = cleanText(briefing?.generated_at)
  const briefingSituation = cleanText(briefing?.situation, 700)
  const briefingMotivation = cleanText(briefing?.motivation, 500)
  const briefingStrategy = cleanText(briefing?.strategy, 700)
  const latestEvidenceAt = recentEvidence[0]?.createdAt ? new Date(recentEvidence[0].createdAt).getTime() : 0
  const briefingTime = briefingAt ? new Date(briefingAt).getTime() : 0
  const briefingRevision = Number(briefing?.source_revision || 0)
  const job = briefingJobResult.data as Record<string, unknown> | null
  const jobRevision = Number(job?.revision || 0)
  const canonicalRefreshPending = Boolean(job) && (job?.status !== 'completed' || briefingRevision < jobRevision)
  const aiBriefing = briefingAt && (briefingSituation || briefingMotivation || briefingStrategy) ? {
    situation: briefingSituation,
    motivation: briefingMotivation,
    strategy: briefingStrategy,
    generatedAt: briefingAt,
    freshness: canonicalRefreshPending || latestEvidenceAt > briefingTime ? 'stale' as const : 'current' as const,
  } : null

  const address = [lead.property_address, lead.city, lead.state, lead.zip]
    .map((value) => cleanText(value, 160)).filter(Boolean).join(', ') || null
  return {
    leadId,
    snapshotAt: nowIso,
    contact: {
      name: cleanText(lead.full_name, 160) || 'Unknown contact',
      address,
      station: cleanText(lead.station, 80),
      priority: cleanText(lead.priority, 80),
    },
    objective: nextObjective,
    aiBriefing,
    facts: facts(lead),
    questions: questions(lead, Boolean(nextObjective), coOwners),
    coOwners,
    recentEvidence,
    sourceRowCount: timeline.items.length + workItems.length + (appointment ? 1 : 0) + coOwners.length + (briefing ? 1 : 0) + (job ? 1 : 0),
  }
}
