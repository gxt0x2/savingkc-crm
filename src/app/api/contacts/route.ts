export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { getContactSignal, type ContactSignal, type OutreachStatus } from '@/lib/contact-display'
import { isNotLeadOutcome } from '@/lib/lead-outcomes'
import { isActiveAcquisitionContact, isProspectingContact } from '@/lib/contact-smart-lists'
import { getPipelineIntentSource } from '@/lib/pipeline-intent'
import { communicationActivitySummary } from '@/lib/operating-model/conversation-presentation'
import type { ConversationHubActivity, ConversationHubThread } from '@/lib/operating-model/conversation-hub'
import { readContactWorkspaceActivitySummaries, type ContactWorkspaceActivitySummary } from '@/lib/server/contact-workspace-read-model'
import { decodeContactDirectoryCursor, readContactDirectoryPage } from '@/lib/server/contact-directory-read-model'
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
const CONTACT_SMART_LISTS = new Set([
  'new', 'hot', 'contacted', 'qualified', 'appointment_set', 'offer_made',
  'in_closing', 'all', 'needs_reply', 'overdue', 'unassigned', 'prospects', 'not_leads',
])
const CONTACT_SORTS = new Set(['priority', 'recent', 'name'])
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

function projectionCommunication(summary: ContactWorkspaceActivitySummary | undefined): ConversationHubActivity | null {
  if (!summary?.last_communication_id || !summary.last_communication_type || !summary.last_communication_at) return null
  return {
    id: summary.last_communication_id,
    lead_id: summary.lead_id,
    activity_type: summary.last_communication_type,
    description: summary.last_communication_description,
    agent: summary.last_communication_agent,
    metadata: summary.last_communication_metadata ?? {},
    created_at: summary.last_communication_at,
  }
}

function projectionAttentionState(summary: ContactWorkspaceActivitySummary | undefined): ConversationHubThread['attentionState'] {
  return summary?.attention_state === 'needs_reply' || summary?.attention_state === 'waiting_on_contact'
    ? summary.attention_state
    : 'resolved'
}

function projectionOutreachStatus(summary: ContactWorkspaceActivitySummary | undefined): OutreachStatus {
  if (summary?.has_connected_call || summary?.has_inbound_message) return 'connected_unclassified'
  return summary?.has_outbound_attempt ? 'attempted_no_response' : 'unattempted'
}

export async function GET(request: NextRequest) {
  const requestStartedAt = performance.now()
  const db = supabaseAdmin()
  if (request.nextUrl.searchParams.get('mode') === 'page') {
    const params = request.nextUrl.searchParams
    const rawCursor = params.get('cursor')
    const cursor = decodeContactDirectoryCursor(rawCursor)
    if (rawCursor && !cursor) {
      return NextResponse.json({ error: 'Invalid contact page cursor' }, { status: 400 })
    }
    const smartList = params.get('list') ?? 'new'
    const sort = params.get('sort') ?? 'priority'
    if (!CONTACT_SMART_LISTS.has(smartList) || !CONTACT_SORTS.has(sort)) {
      return NextResponse.json({ error: 'Invalid contact directory query' }, { status: 400 })
    }
    const requestedLimit = Number(params.get('limit') ?? 25)
    const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 50) : 25
    const scope = smartList === 'prospects' ? 'prospects' : smartList === 'not_leads' ? 'not_leads' : 'active'
    try {
      const page = await readContactDirectoryPage({
        smartList,
        scope,
        limit,
        cursor,
        sort,
        search: params.get('q') ?? '',
        owner: params.get('owner') ?? '',
        stage: params.get('stage') ?? '',
        minimumStage: params.get('min_stage') ?? '',
        source: params.get('source') ?? '',
        tag: params.get('tag') ?? '',
        activity: params.get('activity') ?? '',
        attention: params.get('attention') ?? '',
        outreach: params.get('outreach') ?? '',
        dataGap: params.get('gap') ?? '',
        referenceTime: new Date().toISOString(),
      }, db)

      const items: ContactRow[] = page.items.map((item) => {
        const manifest = item.manifest as ManifestPayload
        const communication: ConversationHubActivity | null = item.last_communication_id && item.last_communication_type && item.last_communication_at ? {
          id: item.last_communication_id,
          lead_id: item.id,
          activity_type: item.last_communication_type,
          description: item.last_communication_description,
          agent: item.last_communication_agent,
          metadata: item.last_communication_metadata ?? {},
          created_at: item.last_communication_at,
        } : null
        const dueAt = item.primary_next_action_due_at
        return {
          id: item.id,
          fullName: item.full_name,
          phone: item.phone,
          email: item.email,
          source: item.source,
          address: item.address,
          city: item.city,
          station: item.station as DealStage,
          classification: item.classification,
          deadReason: item.dead_reason,
          owner: item.owner,
          score: item.score,
          isFavorite: item.is_favorite,
          nextActivity: pickNextActivity(manifest),
          tags: pickTags(manifest),
          lastContactAt: manifest.communications?.lastSellerContactDate ?? manifest.communications?.lastInboundDate ?? null,
          createdAt: item.created_at,
          firstOutboundAt: item.first_outbound_at,
          contactSignal: communication ? getContactSignal(communication) : null,
          outreachStatus: item.outreach_status,
          updatedAt: item.updated_at,
          pipelineIntentSource: item.pipeline_intent_source,
          attentionState: item.attention_state,
          lastMessage: communication ? communicationActivitySummary(communication) : 'No messages yet',
          lastActivityAt: item.last_activity_at,
          primaryNextAction: item.primary_next_action_id ? {
            id: item.primary_next_action_id,
            title: item.primary_next_action_title?.trim() || 'Next action',
            dueAt,
            owner: item.primary_next_action_owner ?? item.owner,
            overdue: Boolean(dueAt && new Date(dueAt) < new Date()),
          } : null,
        }
      })

      return NextResponse.json({
        items,
        scope,
        scopeCounts: page.scopeCounts,
        counts: page.smartListCounts,
        facets: page.facets,
        pageInfo: { limit, total: page.totalCount, hasMore: page.hasMore, nextCursor: page.nextCursor },
      }, {
        headers: {
          'Cache-Control': 'private, no-store',
          'Server-Timing': `contact-page;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
        },
      })
    } catch (error) {
      console.error('Contact directory request failed', error)
      return NextResponse.json({ error: 'Contacts could not be loaded' }, { status: 503 })
    }
  }
  const requestedScope = request.nextUrl.searchParams.get('scope')
  const scope = requestedScope === 'not_leads' || requestedScope === 'prospects' || requestedScope === 'all' ? requestedScope : 'active'

  const { data: leads, error: leadsErr } = await db
    .from('leads')
    .select('id, full_name, phone, email, source, station, classification, dead_reason, assigned_agent, property_address, city, created_at, updated_at, is_parked, is_favorite')
    .eq('is_parked', false)
    .order('updated_at', { ascending: false })

  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 })
  const rows = leads ?? []
  const rowIds = rows.map((lead) => lead.id)
  const summaryStartedAt = performance.now()
  const activitySummaries = await readContactWorkspaceActivitySummaries(rowIds, db)
  const summaryDuration = performance.now() - summaryStartedAt
  const intentActivitiesByLead = new Map<string, Array<{ activity_type?: unknown; metadata?: unknown }>>()
  for (const [leadId, summary] of activitySummaries) {
    if (!summary.pipeline_intent_activity_type) continue
    intentActivitiesByLead.set(leadId, [{
      activity_type: summary.pipeline_intent_activity_type,
      metadata: summary.pipeline_intent_metadata,
    }])
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

  if (scopedRows.length === 0) {
    return NextResponse.json({ items: [], scope, scopeCounts }, {
      headers: {
        'Server-Timing': `activity-summary;dur=${summaryDuration.toFixed(1)}, total;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
      },
    })
  }

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

  const items: ContactRow[] = []
  for (const { lead, station, pipelineIntentSource } of scopedRows) {
    const manifest = latestManifest.get(lead.id) ?? {}
    const summary = activitySummaries.get(lead.id)
    const communication = projectionCommunication(summary)
    const dueAt = summary?.primary_next_action_due_at ?? null
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
      owner: summary?.owner ?? lead.assigned_agent ?? null,
      score: scoreByLead.get(lead.id) ?? 0,
      isFavorite: Boolean((lead as { is_favorite?: boolean | null }).is_favorite),
      nextActivity: pickNextActivity(manifest),
      tags: pickTags(manifest),
      lastContactAt,
      createdAt: lead.created_at,
      firstOutboundAt: summary?.first_outbound_at ?? null,
      contactSignal: communication ? getContactSignal(communication) : null,
      outreachStatus: projectionOutreachStatus(summary),
      updatedAt: lead.updated_at,
      pipelineIntentSource,
      attentionState: projectionAttentionState(summary),
      lastMessage: communication ? communicationActivitySummary(communication) : 'No messages yet',
      lastActivityAt: summary?.last_activity_at ?? lead.created_at ?? lead.updated_at ?? '1970-01-01T00:00:00.000Z',
      primaryNextAction: summary?.primary_next_action_id ? {
        id: summary.primary_next_action_id,
        title: summary.primary_next_action_title?.trim() || 'Next action',
        dueAt,
        owner: summary.primary_next_action_owner ?? summary.owner ?? lead.assigned_agent ?? null,
        overdue: Boolean(dueAt && new Date(dueAt) < new Date()),
      } : null,
    })
  }

  return NextResponse.json({ items, scope, scopeCounts }, {
    headers: {
      'Server-Timing': `activity-summary;dur=${summaryDuration.toFixed(1)}, total;dur=${(performance.now() - requestStartedAt).toFixed(1)}`,
    },
  })
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
