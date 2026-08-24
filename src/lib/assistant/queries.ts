import { PHONE_SYSTEM } from '@/lib/operating-model/phone-system'
import { WORKFLOW_CATALOG, workflowCategoryLabel } from '@/lib/operating-model/workflow-catalog'
import { readStoredWorkflowDefinitions } from '@/lib/operating-model/workflow-store'
import { readOperatingSnapshot } from '@/lib/assistant/operating-snapshot'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { assistantActorCanReadCompanyWide, type AssistantActor } from '@/lib/assistant/auth'
import { ASSISTANT_ACTIVE_STAGES, cleanLeadSearch, crmLeadUrl } from '@/lib/assistant/read-model'

type Db = ReturnType<typeof supabaseAdmin>
type JsonRecord = Record<string, unknown>

const CRM_ORIGIN = (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/+$/, '')
const TASK_ACTIVITY_TYPES = ['task', 'appointment', 'follow_up', 'callback', 'send_offer']
const COMMUNICATION_ACTIVITY_TYPES = ['call', 'sms', 'email', 'voicemail', 'note']
const BLOCKED_METADATA_KEY = /(secret|token|password|credential|authorization|cookie|api[_-]?key|private[_-]?key|recording.*url|audio.*url|signed.*url)/i
const MAX_METADATA_STRING_LENGTH = 12_000

function source(name: string, url: string, generatedAt: string, detail?: string) {
  return { name, url, generatedAt, ...(detail ? { detail } : {}) }
}

function metadataRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {}
}

export function sanitizeAssistantMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return '[nested data omitted]'
  if (typeof value === 'string' && value.length > MAX_METADATA_STRING_LENGTH) {
    return `${value.slice(0, MAX_METADATA_STRING_LENGTH)}\n[content truncated]`
  }
  if (Array.isArray(value)) return value.slice(0, 50).map((item) => sanitizeAssistantMetadata(item, depth + 1))
  if (!value || typeof value !== 'object') return value

  return Object.fromEntries(
    Object.entries(value as JsonRecord)
      .filter(([key]) => !BLOCKED_METADATA_KEY.test(key))
      .map(([key, item]) => [key, sanitizeAssistantMetadata(item, depth + 1)]),
  )
}

function actorLeadQuery<T>(query: T, actor: AssistantActor): T {
  if (assistantActorCanReadCompanyWide(actor)) return query
  const scoped = query as T & { ilike(column: string, pattern: string): T }
  return scoped.ilike('assigned_agent', `%${actor.fullName}%`)
}

function canActorReadLead(actor: AssistantActor, assignedAgent: unknown): boolean {
  if (assistantActorCanReadCompanyWide(actor)) return true
  return String(assignedAgent || '').toLowerCase().includes(actor.fullName.toLowerCase())
}

function countBy(rows: JsonRecord[], key: string, fallback = 'not recorded') {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const label = String(row[key] || fallback).trim() || fallback
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .map(([label, count]) => ({ label, count }))
}

function mapLeadLink<T extends JsonRecord>(row: T): T & { crmUrl: string } {
  return { ...row, crmUrl: crmLeadUrl(String(row.id)) }
}

function activityDueAt(row: JsonRecord): string | null {
  const metadata = metadataRecord(row.metadata)
  const value = metadata.due_date || metadata.dueAt || metadata.scheduled_at
  return typeof value === 'string' && value ? value : null
}

function activityStatus(row: JsonRecord): string {
  const metadata = metadataRecord(row.metadata)
  return String(metadata.status || 'pending').toLowerCase()
}

function isOpenActivity(row: JsonRecord): boolean {
  return !['completed', 'complete', 'done', 'cancelled', 'canceled', 'waived'].includes(activityStatus(row))
}

async function leadMap(db: Db, ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map<string, JsonRecord>()
  const { data, error } = await db
    .from('leads')
    .select('id, full_name, property_address, city, state, station, priority, assigned_agent')
    .in('id', unique)
  if (error) throw new Error(`Lead relationship lookup failed: ${error.message}`)
  return new Map(((data || []) as JsonRecord[]).map((row) => [String(row.id), row]))
}

export function readAssistantSourceCatalog(generatedAt = new Date().toISOString()) {
  return {
    generatedAt,
    readOnly: true,
    sources: [
      { id: 'crm', name: 'SavingKC CRM / Supabase', authority: 'Seller, lead, activity, appointment, deal, task, workflow and first-party attribution facts', freshness: 'live per request', connected: true },
      { id: 'website-content', name: 'savingkc.com production content', authority: 'Published public claims and pages', freshness: 'live fetch by the Google Chat agent', connected: true },
      { id: 'website-first-party', name: 'Website first-party tracking', authority: 'Form steps, submissions, click IDs and attribution stored in CRM', freshness: 'live per request', connected: true },
      { id: 'google-ads-export', name: 'PPC conversion outbox', authority: 'Offline conversion queue and delivery status', freshness: 'live per request', connected: true },
      { id: 'google-analytics', name: 'Google Analytics 4', authority: 'Aggregated traffic and engagement', freshness: 'not connected to this assistant yet', connected: false },
      { id: 'search-console', name: 'Google Search Console', authority: 'Organic queries, indexing and search performance', freshness: 'not connected to this assistant yet', connected: false },
      { id: 'vercel', name: 'Vercel deployment/runtime telemetry', authority: 'Deployments, function errors and uptime', freshness: 'health probes available; authenticated telemetry not connected yet', connected: false },
    ],
  }
}

export async function searchAssistantLeads(db: Db, actor: AssistantActor, queryValue: string, limit = 8) {
  const query = cleanLeadSearch(queryValue)
  const generatedAt = new Date().toISOString()
  if (!query) return { action: 'lead_search', generatedAt, query, records: [], sources: [] }

  const selection = 'id, full_name, phone, email, property_address, city, state, station, priority, source, assigned_agent, classification, created_at, updated_at'
  const pattern = `%${query}%`
  const fields = ['full_name', 'property_address', 'phone', 'email'] as const
  const results = await Promise.all(fields.map((field) => {
    const base = db.from('leads').select(selection).ilike(field, pattern).order('updated_at', { ascending: false }).limit(limit)
    return actorLeadQuery(base, actor)
  }))

  const failed = results.find((result) => result.error)
  if (failed?.error) throw new Error(`Lead search failed: ${failed.error.message}`)
  const unique = new Map<string, JsonRecord>()
  for (const result of results) {
    for (const row of (result.data || []) as JsonRecord[]) unique.set(String(row.id), row)
  }
  const records = [...unique.values()].slice(0, limit).map(mapLeadLink)
  return {
    action: 'lead_search',
    generatedAt,
    query,
    records,
    sources: [source('SavingKC CRM leads', `${CRM_ORIGIN}/contacts`, generatedAt, 'Live name, address, phone and email lookup')],
  }
}

export async function readAssistantLead360(db: Db, actor: AssistantActor, leadId: string) {
  const generatedAt = new Date().toISOString()
  const { data: lead, error } = await db
    .from('leads')
    .select('id, full_name, phone, email, property_address, city, state, zip, county, source, station, priority, notes, assigned_agent, classification, opportunity_score, motivation_score, seller_situation, property_condition, asking_price, arv, repair_estimate, offer_amount, assignment_fee, form_status, created_at, updated_at')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw new Error(`Lead lookup failed: ${error.message}`)
  if (!lead) return { action: 'lead_360', generatedAt, record: null, sources: [] }
  if (!canActorReadLead(actor, lead.assigned_agent)) throw new Error('Forbidden: this lead is outside the actor scope')

  const [activitiesResult, appointmentsResult, dealsResult, offersResult, filesResult] = await Promise.all([
    db.from('lead_activities').select('id, activity_type, description, agent, metadata, created_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(100),
    db.from('appointments').select('id, type, status, scheduled_at, assigned_to, address, notes, source, created_at').eq('lead_id', leadId).order('scheduled_at', { ascending: false }).limit(25),
    db.from('dispo_deals').select('id, stage, closeout_status, assignment_fee, close_date, accepted_offer_id, accepted_buyer_id, debrief_due_at, debrief_completed_at, created_at, updated_at').eq('lead_id', leadId).order('updated_at', { ascending: false }).limit(20),
    db.from('buyer_offers').select('id, buyer_id, offer_amount, earnest_money, close_days, inspection_days, financing_type, contingencies, status, counter_amount, submitted_at, decided_at, created_at, updated_at').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(25),
    db.from('tc_files').select('id, dispo_deal_id, buyer_offer_id, file_number, status, emd_due_at, emd_confirmed_at, title_clear_at, closing_scheduled_at, closing_completed_at, assignment_fee, revenue_logged_at, next_action, risk_level, risk_reason, created_at, updated_at').eq('lead_id', leadId).order('updated_at', { ascending: false }).limit(20),
  ])

  const availability: Record<string, string> = {}
  const safeData = (name: string, result: { data: unknown; error: { message: string } | null }) => {
    availability[name] = result.error ? result.error.message : 'available'
    return result.error ? [] : (result.data || []) as JsonRecord[]
  }

  const activities = safeData('activities', activitiesResult).map((row) => ({ ...row, metadata: sanitizeAssistantMetadata(row.metadata) }))
  const appointments = safeData('appointments', appointmentsResult)
  const deals = safeData('dispositionDeals', dealsResult)
  const buyerOffers = safeData('buyerOffers', offersResult)
  const files = safeData('transactionCoordination', filesResult)
  const fileIds = files.map((file) => String(file.id))
  const taskResult = fileIds.length
    ? await db.from('tc_tasks').select('id, tc_file_id, task_type, label, status, due_at, completed_at, assigned_to, source, notes, created_at, updated_at').in('tc_file_id', fileIds).order('due_at', { ascending: true })
    : { data: [], error: null }
  const tcTasks = safeData('tcTasks', taskResult)

  return {
    action: 'lead_360',
    generatedAt,
    record: {
      lead: mapLeadLink(lead as JsonRecord),
      activities,
      appointments,
      dispositionDeals: deals,
      buyerOffers,
      transactionCoordination: files.map((file) => ({ ...file, tasks: tcTasks.filter((task) => String(task.tc_file_id) === String(file.id)) })),
    },
    availability,
    sources: [
      source('SavingKC CRM lead record', crmLeadUrl(leadId), generatedAt),
      source('SavingKC CRM activity timeline', `${crmLeadUrl(leadId)}?section=activity`, generatedAt),
    ],
  }
}

export async function readAssistantCommunications(db: Db, actor: AssistantActor, leadId: string, limit = 50) {
  const generatedAt = new Date().toISOString()
  const { data: lead, error: leadError } = await db.from('leads').select('id, full_name, assigned_agent').eq('id', leadId).maybeSingle()
  if (leadError) throw new Error(`Lead lookup failed: ${leadError.message}`)
  if (!lead) return { action: 'communications', generatedAt, lead: null, records: [], sources: [] }
  if (!canActorReadLead(actor, lead.assigned_agent)) throw new Error('Forbidden: this lead is outside the actor scope')

  const { data, error } = await db
    .from('lead_activities')
    .select('id, activity_type, description, agent, metadata, created_at')
    .eq('lead_id', leadId)
    .in('activity_type', COMMUNICATION_ACTIVITY_TYPES)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Communication history failed: ${error.message}`)
  return {
    action: 'communications',
    generatedAt,
    lead: { id: lead.id, name: lead.full_name, crmUrl: crmLeadUrl(leadId) },
    records: ((data || []) as JsonRecord[]).map((row) => ({ ...row, metadata: sanitizeAssistantMetadata(row.metadata) })),
    sources: [source('SavingKC CRM communications', `${crmLeadUrl(leadId)}?section=activity`, generatedAt, 'Calls, SMS, email, voicemail and notes')],
  }
}

export async function readAssistantAttention(db: Db, actor: AssistantActor, limit = 15) {
  const generatedAt = new Date().toISOString()
  const now = new Date()
  const nextWeek = new Date(now.getTime() + 7 * 86_400_000).toISOString()
  const staleCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()

  const activityBase = db.from('lead_activities').select('id, lead_id, activity_type, description, agent, metadata, created_at').in('activity_type', TASK_ACTIVITY_TYPES).order('created_at', { ascending: false }).limit(1000)
  const leadBase = db.from('leads').select('id, full_name, property_address, city, state, station, priority, assigned_agent, updated_at').in('station', ASSISTANT_ACTIVE_STAGES).lt('updated_at', staleCutoff).order('updated_at', { ascending: true }).limit(limit)
  const [activitiesResult, appointmentsResult, staleLeadsResult, tcTasksResult, tcFilesResult, dealsResult] = await Promise.all([
    activityBase,
    db.from('appointments').select('id, lead_id, scheduled_at, type, status, assigned_to, address, notes').in('status', ['scheduled', 'confirmed']).gte('scheduled_at', generatedAt).lte('scheduled_at', nextWeek).order('scheduled_at', { ascending: true }).limit(limit),
    actorLeadQuery(leadBase, actor),
    db.from('tc_tasks').select('id, tc_file_id, task_type, label, status, due_at, assigned_to, notes, created_at').in('status', ['open', 'blocked']).order('due_at', { ascending: true, nullsFirst: false }).limit(100),
    db.from('tc_files').select('id, lead_id, file_number, status, risk_level, next_action, closing_scheduled_at, emd_due_at').neq('status', 'cancelled').limit(300),
    db.from('dispo_deals').select('id, lead_id, stage, closeout_status, close_date, debrief_due_at, assignment_fee, updated_at').neq('stage', 'dead').order('updated_at', { ascending: false }).limit(300),
  ])

  if (activitiesResult.error || staleLeadsResult.error) throw new Error(`CRM attention lookup failed: ${(activitiesResult.error || staleLeadsResult.error)?.message}`)
  const allActivities = (activitiesResult.data || []) as JsonRecord[]
  const scopedActivities = assistantActorCanReadCompanyWide(actor)
    ? allActivities
    : allActivities.filter((row) => {
      const metadata = metadataRecord(row.metadata)
      return [row.agent, metadata.assigned_to].some((value) => String(value || '').toLowerCase().includes(actor.fullName.toLowerCase()))
    })
  const tasks = scopedActivities.filter(isOpenActivity).sort((left, right) => String(activityDueAt(left) || '9999').localeCompare(String(activityDueAt(right) || '9999'))).slice(0, limit)
  const tcFiles = tcFilesResult.error ? [] : (tcFilesResult.data || []) as JsonRecord[]
  const tcFileMap = new Map(tcFiles.map((file) => [String(file.id), file]))
  const tcTasks = tcTasksResult.error ? [] : ((tcTasksResult.data || []) as JsonRecord[])
    .filter((task) => {
      const file = tcFileMap.get(String(task.tc_file_id))
      return file && (assistantActorCanReadCompanyWide(actor) || String(task.assigned_to || '').toLowerCase().includes(actor.fullName.toLowerCase()))
    })
    .slice(0, limit)
  const appointments = appointmentsResult.error ? [] : (appointmentsResult.data || []) as JsonRecord[]
  const deals = dealsResult.error ? [] : (dealsResult.data || []) as JsonRecord[]

  const ids = [
    ...tasks.map((task) => String(task.lead_id || '')),
    ...appointments.map((appointment) => String(appointment.lead_id || '')),
    ...tcTasks.map((task) => String(tcFileMap.get(String(task.tc_file_id))?.lead_id || '')),
    ...deals.map((deal) => String(deal.lead_id || '')),
  ]
  const leads = await leadMap(db, ids)
  const actorCanReadCompanyWide = assistantActorCanReadCompanyWide(actor)
  const leadIsVisible = (leadId: unknown) => {
    const lead = leads.get(String(leadId || ''))
    return Boolean(lead && canActorReadLead(actor, lead.assigned_agent))
  }
  const visibleAppointments = actorCanReadCompanyWide
    ? appointments
    : appointments.filter((appointment) => leadIsVisible(appointment.lead_id))
  const visibleDeals = actorCanReadCompanyWide
    ? deals
    : deals.filter((deal) => leadIsVisible(deal.lead_id))
  const attachLead = (leadId: unknown) => {
    const lead = leads.get(String(leadId || ''))
    return lead ? { ...lead, crmUrl: crmLeadUrl(String(lead.id)) } : null
  }

  return {
    action: 'attention',
    generatedAt,
    tasks: tasks.map((task) => ({ ...task, dueAt: activityDueAt(task), status: activityStatus(task), metadata: sanitizeAssistantMetadata(task.metadata), lead: attachLead(task.lead_id), crmUrl: task.lead_id ? crmLeadUrl(String(task.lead_id)) : null })),
    appointments: visibleAppointments.map((appointment) => ({ ...appointment, lead: attachLead(appointment.lead_id), crmUrl: appointment.lead_id ? crmLeadUrl(String(appointment.lead_id)) : null })),
    staleLeads: ((staleLeadsResult.data || []) as JsonRecord[]).map(mapLeadLink),
    transactionCoordination: tcTasks.map((task) => {
      const file = tcFileMap.get(String(task.tc_file_id))
      return { ...task, file, lead: attachLead(file?.lead_id), crmUrl: file?.lead_id ? crmLeadUrl(String(file.lead_id)) : `${CRM_ORIGIN}/tc` }
    }),
    dispositionDeadlines: visibleDeals.filter((deal) => deal.close_date || deal.debrief_due_at || deal.closeout_status === 'awaiting_debrief').slice(0, limit).map((deal) => ({ ...deal, lead: attachLead(deal.lead_id), crmUrl: deal.lead_id ? crmLeadUrl(String(deal.lead_id)) : `${CRM_ORIGIN}/dispo` })),
    availability: {
      appointments: appointmentsResult.error ? appointmentsResult.error.message : 'available',
      tcTasks: tcTasksResult.error || tcFilesResult.error ? (tcTasksResult.error || tcFilesResult.error)?.message : 'available',
      dispositions: dealsResult.error ? dealsResult.error.message : 'available',
    },
    sources: [
      source('SavingKC canonical activity tasks', `${CRM_ORIGIN}/calendar`, generatedAt, 'lead_activities task, follow-up, callback and offer actions'),
      source('SavingKC appointments', `${CRM_ORIGIN}/calendar`, generatedAt),
      source('SavingKC TC tasks and disposition deadlines', `${CRM_ORIGIN}/tc`, generatedAt),
    ],
  }
}

export async function readAssistantOperatingSnapshot(days: number) {
  const snapshot = await readOperatingSnapshot(days)
  return {
    action: 'operating_snapshot',
    ...snapshot,
    sources: [source('SavingKC CRM operating model', `${CRM_ORIGIN}/reports`, snapshot.generatedAt, 'Leads, activities, disposition deals and configured goals')],
  }
}

export async function readAssistantWorkflowRegistry(db: Db, search?: string) {
  const generatedAt = new Date().toISOString()
  let stored: Awaited<ReturnType<typeof readStoredWorkflowDefinitions>> = []
  let storedAvailability = 'available'
  try {
    stored = await readStoredWorkflowDefinitions(db)
  } catch (error) {
    storedAvailability = error instanceof Error ? error.message : 'unavailable'
  }
  const needle = search?.trim().toLowerCase()
  const records = [...WORKFLOW_CATALOG, ...stored.map((entry) => entry.definition)]
    .filter((workflow) => !needle || [workflow.name, workflow.description, workflow.category, workflow.owner.displayName, ...workflow.implementation.sourceFiles].some((value) => value.toLowerCase().includes(needle)))
    .map((workflow) => ({ ...workflow, categoryLabel: workflowCategoryLabel(workflow.category) }))
  return {
    action: 'workflow_registry', generatedAt, records, availability: { storedWorkflows: storedAvailability },
    sources: [source('SavingKC approved workflow registry', `${CRM_ORIGIN}/workflows?section=all`, generatedAt)],
  }
}

export function readAssistantPhoneSystem(search?: string) {
  const generatedAt = new Date().toISOString()
  const needle = search?.trim().toLowerCase()
  const records = PHONE_SYSTEM.filter((record) => !needle || [record.number, record.label, record.owner, record.team, record.workflowId, record.healthNote].some((value) => value.toLowerCase().includes(needle)))
  return {
    action: 'phone_system', generatedAt, records,
    sources: [source('SavingKC protected phone registry', `${CRM_ORIGIN}/workflows?section=phones`, generatedAt)],
  }
}

export async function readAssistantWebsiteFunnel(db: Db, days: number) {
  const generatedAt = new Date().toISOString()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const [leadsResult, eventsResult] = await Promise.all([
    db.from('leads').select('id, full_name, source, form_status, station, classification, created_at, updated_at').gte('created_at', since).order('created_at', { ascending: false }).limit(5000),
    db.from('ppc_tracking_events').select('id, event_name, event_category, event_time, lead_id, page_path, traffic_source, campaign, utm_source, utm_medium, utm_campaign, form_step, form_status, is_test').gte('event_time', since).eq('is_test', false).order('event_time', { ascending: false }).limit(5000),
  ])
  if (leadsResult.error) throw new Error(`Website lead funnel unavailable: ${leadsResult.error.message}`)
  const leads = (leadsResult.data || []) as JsonRecord[]
  const events = eventsResult.error ? [] : (eventsResult.data || []) as JsonRecord[]
  const recent = leads.slice(0, 15).map(mapLeadLink)
  return {
    action: 'website_funnel', generatedAt, periodDays: days,
    leads: { total: leads.length, bySource: countBy(leads, 'source'), byFormStatus: countBy(leads, 'form_status'), byClassification: countBy(leads, 'classification'), recent },
    firstPartyEvents: { total: events.length, byName: countBy(events, 'event_name'), byCategory: countBy(events, 'event_category'), byPage: countBy(events, 'page_path'), byCampaign: countBy(events, 'campaign'), recent: events.slice(0, 20) },
    availability: { firstPartyEvents: eventsResult.error ? eventsResult.error.message : 'available', ga4: 'not connected', searchConsole: 'not connected' },
    sources: [
      source('SavingKC website leads stored in CRM', `${CRM_ORIGIN}/contacts`, generatedAt),
      source('SavingKC first-party website tracking', `${CRM_ORIGIN}/marketing`, generatedAt, 'Form, visit, phone and conversion events; excludes test events'),
    ],
  }
}

export async function readAssistantMarketingSummary(db: Db, days: number) {
  const generatedAt = new Date().toISOString()
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const [leadsResult, eventsResult, outboxResult] = await Promise.all([
    db.from('leads').select('id, source, station, classification, opportunity_score, created_at').gte('created_at', since).order('created_at', { ascending: false }).limit(5000),
    db.from('ppc_tracking_events').select('event_name, event_category, event_time, traffic_source, campaign, lead_id, gclid, gbraid, wbraid, is_test').gte('event_time', since).eq('is_test', false).order('event_time', { ascending: false }).limit(5000),
    db.from('ppc_conversion_outbox').select('id, event_name, event_category, status, optimization_role, lead_id, conversion_value, event_time, click_id_type, attempts, last_error, approved_for_google_ads, sent_at, created_at, updated_at').gte('event_time', since).order('event_time', { ascending: false }).limit(2000),
  ])
  if (leadsResult.error) throw new Error(`Marketing lead summary unavailable: ${leadsResult.error.message}`)
  const leads = (leadsResult.data || []) as JsonRecord[]
  const events = eventsResult.error ? [] : (eventsResult.data || []) as JsonRecord[]
  const outbox = outboxResult.error ? [] : (outboxResult.data || []) as JsonRecord[]
  const pending = outbox.filter((row) => ['pending', 'processing', 'failed', 'dead_letter'].includes(String(row.status)))
  return {
    action: 'marketing_summary', generatedAt, periodDays: days,
    leads: { total: leads.length, bySource: countBy(leads, 'source'), byStage: countBy(leads, 'station'), byClassification: countBy(leads, 'classification') },
    firstPartyEvents: { total: events.length, byName: countBy(events, 'event_name'), byCampaign: countBy(events, 'campaign'), attributedLeadEvents: events.filter((row) => row.lead_id).length, clickIdEvents: events.filter((row) => row.gclid || row.gbraid || row.wbraid).length },
    conversionOutbox: { total: outbox.length, byStatus: countBy(outbox, 'status'), byEvent: countBy(outbox, 'event_name'), byOptimizationRole: countBy(outbox, 'optimization_role'), pending: pending.slice(0, 25) },
    availability: { firstPartyEvents: eventsResult.error ? eventsResult.error.message : 'available', conversionOutbox: outboxResult.error ? outboxResult.error.message : 'available', googleAdsLiveAccount: 'not queried by this read endpoint' },
    sources: [
      source('SavingKC CRM lead attribution', `${CRM_ORIGIN}/marketing`, generatedAt),
      source('SavingKC PPC tracking events', `${CRM_ORIGIN}/marketing`, generatedAt),
      source('SavingKC PPC conversion outbox', `${CRM_ORIGIN}/marketing`, generatedAt, 'Queue state only; no conversion replay or mutation'),
    ],
  }
}

export function assistantResultCount(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const record = value as JsonRecord
  for (const key of ['records', 'tasks', 'staleLeads']) {
    if (Array.isArray(record[key])) return record[key].length
  }
  if (record.record) return 1
  return null
}
