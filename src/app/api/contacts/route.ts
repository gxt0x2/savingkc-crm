export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getContactSignal, getOutreachStatus, isOutboundAttempt, type ContactActivityLike, type ContactSignal, type OutreachStatus } from '@/lib/contact-display'
import { isNotLeadOutcome } from '@/lib/lead-outcomes'
import { isActiveAcquisitionContact, isProspectingContact } from '@/lib/contact-smart-lists'
import { getPipelineIntentSource } from '@/lib/pipeline-intent'
import { buildConversationHubThread, type ConversationHubActivity, type ConversationHubThread } from '@/lib/operating-model/conversation-hub'
import { readConversationActivitySnapshot } from '@/lib/server/conversation-activity-snapshot'
import { ACQUISITION_STAGES, normalizeDealStage, type DealStage } from '@/types/pipeline'

/**
 * GET /api/contacts
 *
 * Returns one row per contact with the fields the Contacts
 * smart list needs: name, address, phone, next activity, tags, station,
 * composite score. Parked records are excluded here. Active work is the
 * default contract; dead/lost records are only returned through the explicit
 * not_leads archive scope so they cannot leak back into an active smart list.
 *
 * Auth: session (the page is auth-gated).
 */

export interface ContactRow {
  id: string
  fullName: string | null
  phone: string | null
  email: string | null
  source: string | null
  address: string | null
  city: string | null
  station: DealStage
  classification: 'lead' | 'opportunity' | 'dead' | null
  deadReason: string | null
  owner: string | null
  score: number
  isFavorite: boolean
  nextActivity: {
    when: string | null
    label: string
    kind: 'appointment' | 'recommended' | null
  } | null
  tags: string[]
  lastContactAt: string | null
  createdAt: string | null
  firstOutboundAt: string | null
  contactSignal: ContactSignal | null
  outreachStatus: OutreachStatus
  updatedAt: string | null
  pipelineIntentSource: string | null
  attentionState: ConversationHubThread['attentionState']
  lastMessage: string
  lastActivityAt: string
  primaryNextAction: ConversationHubThread['primaryNextAction']
}

interface ManifestPayload {
  pipeline?: {
    appointment?: {
      status?: string
      scheduledAt?: string | null
    }
  }
  ariIntelligence?: {
    recommendedActions?: Array<{ action?: string; dateTime?: string; reason?: string }>
  }
  flags?: {
    opportunityFlags?: string[]
    redFlags?: string[]
  }
  situation?: {
    type?: string[]
    timeline?: {
      lifeEventType?: string
    }
  }
  communications?: {
    lastSellerContactDate?: string
    lastInboundDate?: string
  }
}

const CONTACT_STAGES = new Set<DealStage>([
  ...ACQUISITION_STAGES,
  'under_contract',
  'closed_won',
  'closed_lost',
  'dead',
])
const CONTACT_ACTIVITY_TYPES = ['call', 'sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'email_sent', 'email_received', 'voicemail', 'missed_call', 'task', 'status_change']
const CONTACT_ACTIVITY_TYPE_SET = new Set(CONTACT_ACTIVITY_TYPES)

function getContactStation(station: string | null | undefined): DealStage | null {
  const normalized = normalizeDealStage(station) ?? 'new'
  return CONTACT_STAGES.has(normalized) ? normalized : null
}

function pickNextActivity(m: ManifestPayload): ContactRow['nextActivity'] {
  const appt = m.pipeline?.appointment
  if (appt && appt.status && ['scheduled', 'confirmed', 'reconfirmed'].includes(appt.status.toLowerCase())) {
    const rawAt = typeof appt.scheduledAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(appt.scheduledAt)
      ? appt.scheduledAt
      : null
    if (rawAt) {
      return { kind: 'appointment', when: rawAt, label: 'Appointment' }
    }
  }
  const rec = m.ariIntelligence?.recommendedActions?.[0]
  if (rec?.action) {
    return { kind: 'recommended', when: rec.dateTime ?? null, label: rec.action }
  }
  return null
}

function pickTags(m: ManifestPayload): string[] {
  const tags = new Set<string>()
  for (const f of m.flags?.opportunityFlags ?? []) {
    if (typeof f === 'string' && f.trim()) tags.add(f.trim())
  }
  for (const t of m.situation?.type ?? []) {
    if (typeof t === 'string' && t.trim()) tags.add(t.trim())
  }
  const life = m.situation?.timeline?.lifeEventType
  if (life && life !== 'other') tags.add(life)
  return [...tags].slice(0, 6)
}

export async function GET(request: NextRequest) {
  const db = supabaseAdmin()
  const requestedScope = request.nextUrl.searchParams.get('scope')
  const scope = requestedScope === 'not_leads' || requestedScope === 'prospects' || requestedScope === 'all' ? requestedScope : 'active'

  const [{ data: leads, error: leadsErr }, activitySnapshot] = await Promise.all([
    db
      .from('leads')
      .select('id, full_name, phone, email, source, station, classification, dead_reason, assigned_agent, property_address, city, created_at, updated_at, is_parked, is_favorite')
      .eq('is_parked', false)
      .order('updated_at', { ascending: false }),
    readConversationActivitySnapshot(),
  ])

  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 })
  const rows = leads ?? []
  const rowIds = rows.map((lead) => lead.id)
  const rowIdSet = new Set(rowIds)
  const intentActivities = activitySnapshot.filter((activity) =>
    Boolean(activity.lead_id && rowIdSet.has(activity.lead_id)) &&
    ['status_change', 'call'].includes(activity.activity_type),
  ).sort((a, b) => a.created_at.localeCompare(b.created_at))
  const intentActivitiesByLead = new Map<string, Array<{ activity_type?: unknown; metadata?: unknown }>>()
  for (const activity of intentActivities) {
    if (!activity.lead_id) continue
    intentActivitiesByLead.set(activity.lead_id, [...(intentActivitiesByLead.get(activity.lead_id) ?? []), activity])
  }
  const classifiedRows = rows
    .map((lead) => ({
      lead,
      station: getContactStation(lead.station),
      pipelineIntentSource: getPipelineIntentSource(lead.source, intentActivitiesByLead.get(lead.id)),
    }))
    .filter((row): row is { lead: typeof rows[number]; station: DealStage; pipelineIntentSource: string | null } => row.station !== null)

  const scopeCounts = classifiedRows.reduce((counts, { lead, station, pipelineIntentSource }) => {
    const contact = {
      classification: (lead.classification as ContactRow['classification']) ?? null,
      station,
      pipelineIntentSource,
    }
    if (isNotLeadOutcome(contact.classification, station)) counts.not_leads += 1
    else if (isProspectingContact(contact)) counts.prospects += 1
    else if (isActiveAcquisitionContact(contact)) counts.active += 1
    return counts
  }, { active: 0, prospects: 0, not_leads: 0 })

  const scopedRows = classifiedRows
    .filter(({ lead, station, pipelineIntentSource }) => {
      const notLead = isNotLeadOutcome(lead.classification, station)
      if (scope === 'not_leads') return notLead
      if (scope === 'prospects') return isProspectingContact({
        classification: (lead.classification as ContactRow['classification']) ?? null,
        station,
        pipelineIntentSource,
      })
      if (scope === 'all') return true
      return isActiveAcquisitionContact({
        classification: (lead.classification as ContactRow['classification']) ?? null,
        station,
        pipelineIntentSource,
      })
    })

  if (scopedRows.length === 0) return NextResponse.json({ items: [], scope, scopeCounts })

  const leadIds = scopedRows.map(({ lead }) => lead.id)

  const [{ data: manifests }, { data: scores }] = await Promise.all([
    db
      .from('manifests')
      .select('lead_id, manifest, created_at')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false }),
    db
      .from('hot_opportunities_cache')
      .select('lead_id, composite_score')
      .in('lead_id', leadIds),
  ])
  const leadIdSet = new Set(leadIds)
  const activities = activitySnapshot.filter((activity) =>
    Boolean(activity.lead_id && leadIdSet.has(activity.lead_id)) &&
    CONTACT_ACTIVITY_TYPE_SET.has(activity.activity_type),
  ).sort((a, b) => a.created_at.localeCompare(b.created_at))

  const latestManifest = new Map<string, ManifestPayload>()
  for (const m of manifests ?? []) {
    if (!latestManifest.has(m.lead_id)) {
      latestManifest.set(m.lead_id, (m.manifest ?? {}) as ManifestPayload)
    }
  }

  const scoreByLead = new Map<string, number>()
  for (const s of scores ?? []) {
    scoreByLead.set(s.lead_id, Number(s.composite_score ?? 0))
  }

  const firstOutboundByLead = new Map<string, string>()
  const latestSignalByLead = new Map<string, ContactSignal>()
  const communicationsByLead = new Map<string, ContactActivityLike[]>()
  const hubActivitiesByLead = new Map<string, ConversationHubActivity[]>()
  for (const activity of activities as ContactActivityLike[]) {
    const leadId = typeof activity.lead_id === 'string' ? activity.lead_id : null
    if (!leadId) continue
    communicationsByLead.set(leadId, [...(communicationsByLead.get(leadId) ?? []), activity])
    hubActivitiesByLead.set(leadId, [
      ...(hubActivitiesByLead.get(leadId) ?? []),
      activity as ConversationHubActivity,
    ])

    if (!firstOutboundByLead.has(leadId) && isOutboundAttempt(activity) && activity.created_at) {
      firstOutboundByLead.set(leadId, activity.created_at)
    }

    const signal = getContactSignal(activity)
    if (signal) latestSignalByLead.set(leadId, signal)
  }

  const items: ContactRow[] = []
  for (const { lead, station, pipelineIntentSource } of scopedRows) {
    const manifest = latestManifest.get(lead.id) ?? {}
    const hubThread = buildConversationHubThread({
      id: lead.id,
      full_name: lead.full_name,
      phone: lead.phone,
      email: lead.email,
      property_address: lead.property_address,
      city: lead.city,
      station,
      priority: null,
      assigned_agent: lead.assigned_agent,
      classification: (lead.classification as ContactRow['classification']) ?? null,
      dead_reason: lead.dead_reason ?? null,
      source: lead.source,
      created_at: lead.created_at ?? lead.updated_at ?? '1970-01-01T00:00:00.000Z',
    }, hubActivitiesByLead.get(lead.id) ?? [])
    const lastContactAt =
      manifest.communications?.lastSellerContactDate ??
      manifest.communications?.lastInboundDate ??
      null

    items.push({
      id: lead.id,
      fullName: lead.full_name,
      phone: lead.phone,
      email: lead.email,
      source: lead.source,
      address: lead.property_address,
      city: lead.city,
      station,
      classification: (lead.classification as ContactRow['classification']) ?? null,
      deadReason: lead.dead_reason ?? null,
      owner: hubThread.owner,
      score: scoreByLead.get(lead.id) ?? 0,
      isFavorite: Boolean((lead as { is_favorite?: boolean | null }).is_favorite),
      nextActivity: pickNextActivity(manifest),
      tags: pickTags(manifest),
      lastContactAt,
      createdAt: lead.created_at,
      firstOutboundAt: firstOutboundByLead.get(lead.id) ?? null,
      contactSignal: latestSignalByLead.get(lead.id) ?? null,
      outreachStatus: getOutreachStatus(communicationsByLead.get(lead.id) ?? []),
      updatedAt: lead.updated_at,
      pipelineIntentSource,
      attentionState: hubThread.attentionState,
      lastMessage: hubThread.lastMessage,
      lastActivityAt: hubThread.lastActivityAt,
      primaryNextAction: hubThread.primaryNextAction,
    })
  }

  return NextResponse.json({ items, scope, scopeCounts })
}

function cleanText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeContactPhone(value: unknown): string | null {
  const raw = cleanText(value)
  if (!raw) return null
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return raw
}

/**
 * POST /api/contacts
 *
 * Creates a manual CRM contact without firing website-intake alerts,
 * automated outreach, or advertising conversion events.
 */
export async function POST(request: NextRequest) {
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null
  if (!payload) return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

  const fullName = cleanText(payload.fullName)
  const phone = normalizeContactPhone(payload.phone)
  const email = cleanText(payload.email)?.toLowerCase() ?? null
  const address = cleanText(payload.address)
  if (!fullName && !phone && !email) {
    return NextResponse.json({ error: 'Add a name, phone number, or email address.' }, { status: 400 })
  }

  const db = supabaseAdmin()
  const { data, error } = await db
    .from('leads')
    .insert({
      full_name: fullName,
      phone,
      email,
      property_address: address,
      city: cleanText(payload.city),
      state: cleanText(payload.state),
      zip: cleanText(payload.zip),
      source: cleanText(payload.source) ?? 'manual_crm',
      station: 'new',
      priority: 'warm',
      is_parked: false,
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, id: data.id }, { status: 201 })
}
