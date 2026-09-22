import 'server-only'

import {
  contactSmartListCounts,
  isActiveAcquisitionContact,
  isProspectingContact,
  contactMatchesSmartList,
  type ContactSmartList,
  type SmartListContact,
} from '@/lib/contact-smart-lists'
import { isNotLeadOutcome } from '@/lib/lead-outcomes'
import { supabaseAdmin } from '@/lib/supabase/admin'
import type { DealStage } from '@/types/pipeline'
import {
  type ContactDirectoryItem,
  type ContactDirectoryPage,
  type ContactDirectoryQuery,
} from '@/lib/server/contact-directory-read-model'

const KNOWN_STAGES = new Set<DealStage>([
  'new', 'contacted', 'qualified', 'appointment_set', 'offer_made',
  'under_contract', 'closed_won', 'closed_lost', 'dead',
])

const STAGE_ALIASES: Record<string, DealStage> = {
  attempting_contact: 'contacted',
  qualifying: 'qualified',
  discovery: 'qualified',
  appt_set: 'appointment_set',
  appointment: 'appointment_set',
  offer: 'offer_made',
  offer_prep: 'offer_made',
  offer_presented: 'offer_made',
  negotiating: 'offer_made',
  negotiations: 'offer_made',
  nurture: 'contacted',
  contract: 'under_contract',
  contract_signed: 'under_contract',
  inspection: 'under_contract',
  closing_prep: 'under_contract',
  closing: 'under_contract',
  closed: 'closed_won',
  disposition: 'closed_won',
}

const STAGE_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  appointment_set: 3,
  offer_made: 4,
  under_contract: 5,
  closed_won: 6,
  closed_lost: 6,
  dead: 6,
}

interface SandboxLeadRow {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  source: string | null
  station: string | null
  classification: string | null
  dead_reason: string | null
  assigned_agent: string | null
  opportunity_score: number | null
  is_favorite: boolean | null
  created_at: string | null
  updated_at: string | null
  is_parked: boolean | null
}

interface SandboxThreadRow {
  owner: string | null
  attention_state: string | null
  last_communication_id: string | null
  last_communication_type: string | null
  last_communication_description: string | null
  last_communication_agent: string | null
  last_communication_metadata: Record<string, unknown> | null
  last_communication_at: string | null
  last_activity_at: string | null
  primary_next_action_id: string | null
  primary_next_action_title: string | null
  primary_next_action_due_at: string | null
  primary_next_action_owner: string | null
}

interface SandboxActivityRow {
  first_outbound_at: string | null
  has_outbound_attempt: boolean | null
  has_connected_call: boolean | null
  has_inbound_message: boolean | null
}

interface ContactDirectoryDatabase {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{ data: unknown; error: { message?: string } | null }>
      }
    }
  }
}

function emptyPage(): ContactDirectoryPage {
  return {
    items: [],
    totalCount: 0,
    hasMore: false,
    nextCursor: null,
    scopeCounts: { active: 0, prospects: 0, not_leads: 0 },
    smartListCounts: contactSmartListCounts([]),
    facets: { owners: [], sources: [], tags: [] },
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function normalizeStage(value: string | null): DealStage | null {
  const raw = value?.trim().toLowerCase() ?? ''
  const stage = STAGE_ALIASES[raw] ?? raw
  return KNOWN_STAGES.has(stage as DealStage) ? stage as DealStage : null
}

function classificationOf(value: string | null): ContactDirectoryItem['classification'] {
  const normalized = value?.trim().toLowerCase()
  if (normalized === 'lead' || normalized === 'opportunity' || normalized === 'dead') return normalized
  return null
}

function attentionOf(value: string | null): ContactDirectoryItem['attention_state'] {
  if (value === 'needs_reply' || value === 'waiting_on_contact') return value
  return 'resolved'
}

function includesSearch(item: ContactDirectoryItem, search: string): boolean {
  const needle = search.trim().toLowerCase()
  if (!needle) return true
  const haystack = [item.full_name, item.phone, item.email, item.address, item.city, item.owner, item.source, item.dead_reason]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

function matchesActivity(lastActivityAt: string, activity: string, referenceTime: string): boolean {
  if (!activity.trim()) return true
  const at = Date.parse(lastActivityAt)
  const reference = Date.parse(referenceTime)
  if (!Number.isFinite(at) || !Number.isFinite(reference)) return false
  if (activity === 'day') return at >= reference - 86_400_000
  if (activity === 'week') return at >= reference - 7 * 86_400_000
  if (activity === 'stale') return at < reference - 7 * 86_400_000 && at > Date.parse('1970-01-01T00:00:00.000Z')
  if (activity === 'none') return at <= Date.parse('1970-01-01T00:00:00.000Z')
  return true
}

export function buildOauthReviewContactDirectoryPage(input: {
  lead: SandboxLeadRow | null
  thread: SandboxThreadRow | null
  activity: SandboxActivityRow | null
  entityAuthority: ContactDirectoryItem['entity_authority']
  query: ContactDirectoryQuery
}): ContactDirectoryPage {
  const lead = input.lead
  const station = normalizeStage(lead?.station ?? null)
  if (!lead || lead.is_parked || !station) return emptyPage()

  const classification = classificationOf(lead.classification)
  const dueAt = text(input.thread?.primary_next_action_due_at)
  const reference = Date.parse(input.query.referenceTime)
  const overdue = Boolean(dueAt && Number.isFinite(reference) && Date.parse(dueAt) < reference)
  const owner = text(input.thread?.owner) ?? text(lead.assigned_agent)
  const attentionState = attentionOf(input.thread?.attention_state ?? null)
  const smartListContact: SmartListContact = {
    station,
    classification,
    score: Number(lead.opportunity_score) || 0,
    isFavorite: lead.is_favorite === true,
    attentionState,
    owner,
    primaryNextAction: input.thread?.primary_next_action_id ? { overdue } : null,
    pipelineIntentSource: null,
  }
  const hasConnected = input.activity?.has_connected_call === true || input.activity?.has_inbound_message === true
  const item: ContactDirectoryItem = {
    id: lead.id,
    full_name: text(lead.full_name),
    phone: text(lead.phone),
    email: text(lead.email),
    source: text(lead.source),
    address: text(lead.property_address),
    city: text(lead.city),
    station,
    classification,
    dead_reason: text(lead.dead_reason),
    owner,
    score: smartListContact.score,
    is_favorite: smartListContact.isFavorite,
    created_at: lead.created_at,
    updated_at: lead.updated_at,
    pipeline_intent_source: null,
    attention_state: attentionState,
    last_communication_id: text(input.thread?.last_communication_id),
    last_communication_type: text(input.thread?.last_communication_type),
    last_communication_description: text(input.thread?.last_communication_description),
    last_communication_agent: text(input.thread?.last_communication_agent),
    last_communication_metadata: input.thread?.last_communication_metadata ?? {},
    last_communication_at: input.thread?.last_communication_at ?? null,
    last_activity_at: input.thread?.last_activity_at ?? lead.created_at ?? lead.updated_at ?? input.query.referenceTime,
    primary_next_action_id: text(input.thread?.primary_next_action_id),
    primary_next_action_title: text(input.thread?.primary_next_action_title),
    primary_next_action_due_at: dueAt,
    primary_next_action_owner: text(input.thread?.primary_next_action_owner),
    first_outbound_at: input.activity?.first_outbound_at ?? null,
    outreach_status: hasConnected
      ? 'connected_unclassified'
      : input.activity?.has_outbound_attempt
        ? 'attempted_no_response'
        : 'unattempted',
    entity_authority: input.entityAuthority,
  }

  const scope = input.query.scope
  const active = isActiveAcquisitionContact(smartListContact)
  const inScope = scope === 'not_leads'
    ? isNotLeadOutcome(classification, station)
    : scope === 'prospects'
      ? isProspectingContact(smartListContact)
      : scope === 'all'
        ? true
        : active
  const smartList = input.query.smartList as ContactSmartList
  const visibleOnActiveList = active && (smartList === 'all' || smartList === 'contacted' || smartList === 'qualified')
  const stageFilter = normalizeStage(text(input.query.stage))
  const minimumStage = normalizeStage(text(input.query.minimumStage))
  const matchesFilters = (inScope && (contactMatchesSmartList(smartListContact, smartList) || visibleOnActiveList))
    && (!text(input.query.owner) || (input.query.owner === '__unassigned' ? !owner : owner === input.query.owner))
    && (!text(input.query.stage) || station === stageFilter)
    && (!minimumStage || (STAGE_RANK[station] ?? -1) >= (STAGE_RANK[minimumStage] ?? -1))
    && (!text(input.query.source) || item.source === input.query.source)
    && (!text(input.query.attention) || item.attention_state === input.query.attention)
    && (!text(input.query.outreach) || item.outreach_status === input.query.outreach)
    && (!text(input.query.dataGap)
      || (input.query.dataGap === 'missing_phone' && !item.phone)
      || (input.query.dataGap === 'missing_email' && !item.email)
      || (input.query.dataGap === 'missing_next_action' && !item.primary_next_action_id))
    && matchesActivity(item.last_activity_at, input.query.activity, input.query.referenceTime)
    && includesSearch(item, input.query.search)

  const visible = matchesFilters && !input.query.cursor
  return {
    items: visible ? [item] : [],
    totalCount: matchesFilters ? 1 : 0,
    hasMore: false,
    nextCursor: null,
    scopeCounts: {
      active: active ? 1 : 0,
      prospects: isProspectingContact(smartListContact) ? 1 : 0,
      not_leads: isNotLeadOutcome(classification, station) ? 1 : 0,
    },
    smartListCounts: {
      ...contactSmartListCounts([smartListContact]),
      ...(active ? { contacted: 1, qualified: 1, all: 1 } : {}),
    },
    facets: {
      owners: inScope && owner ? [owner] : [],
      sources: inScope && item.source ? [item.source] : [],
      tags: [],
    },
  }
}

export async function readOauthReviewContactDirectoryPage(
  query: ContactDirectoryQuery,
  leadId: string,
  db: ContactDirectoryDatabase = supabaseAdmin() as unknown as ContactDirectoryDatabase,
): Promise<ContactDirectoryPage> {
  const [leadResult, threadResult, activityResult, linkResult] = await Promise.all([
    db.from('leads').select('id, full_name, phone, email, property_address, city, source, station, classification, dead_reason, assigned_agent, opportunity_score, is_favorite, created_at, updated_at, is_parked').eq('id', leadId).maybeSingle(),
    db.from('conversation_thread_state').select('owner, attention_state, last_communication_id, last_communication_type, last_communication_description, last_communication_agent, last_communication_metadata, last_communication_at, last_activity_at, primary_next_action_id, primary_next_action_title, primary_next_action_due_at, primary_next_action_owner').eq('lead_id', leadId).maybeSingle(),
    db.from('contact_workspace_activity_state').select('first_outbound_at, has_outbound_attempt, has_connected_call, has_inbound_message').eq('lead_id', leadId).maybeSingle(),
    db.from('crm_lead_entity_links').select('person_id, opportunity_id').eq('lead_id', leadId).maybeSingle(),
  ])
  if (leadResult.error) throw new Error(leadResult.error.message || 'Sandbox contact could not be loaded')

  const link = linkResult.data as { person_id?: string | null; opportunity_id?: string | null } | null
  return buildOauthReviewContactDirectoryPage({
    lead: leadResult.data as SandboxLeadRow | null,
    thread: (threadResult.error ? null : threadResult.data) as SandboxThreadRow | null,
    activity: (activityResult.error ? null : activityResult.data) as SandboxActivityRow | null,
    entityAuthority: link?.person_id && link.opportunity_id ? 'canonical_entities' : 'lead_compatibility',
    query,
  })
}
