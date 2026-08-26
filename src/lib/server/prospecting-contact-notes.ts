import type { SupabaseClient } from '@supabase/supabase-js'

import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import { ProspectingCampaignError } from '@/lib/server/prospecting-campaigns'
import { supabase } from '@/lib/supabase-lazy'

export interface ProspectingContactNoteInput {
  leadId?: unknown
  prospectId?: unknown
  campaignMemberId?: unknown
  dialerSessionId?: unknown
  contactKey?: unknown
  contactName?: unknown
  relation?: unknown
  description?: unknown
}

type ContactNoteDatabase = Pick<SupabaseClient, 'from'>

function optionalText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  const normalized = optionalText(value, maxLength)
  if (!normalized) throw new ProspectingCampaignError('invalid_contact_note', 400, `${field} is required`)
  return normalized
}

function databaseFailure(
  context: string,
  error: { message?: string } | null | undefined,
  publicMessage = 'The contact note could not be saved',
): never {
  console.error(`[prospecting-contact-note] ${context}`, error?.message || 'Unknown database error')
  throw new ProspectingCampaignError('contact_note_unavailable', 503, publicMessage)
}

export async function loadProspectingContactNotes(
  rawProspectId: unknown,
  database: ContactNoteDatabase = supabase,
) {
  const prospectId = requiredText(rawProspectId, 'Source Prospect', 80)
  const { data, error } = await database
    .from('lead_activities')
    .select('id,lead_id,activity_type,description,agent,metadata,created_at')
    .eq('activity_type', 'note')
    .contains('metadata', {
      source: 'prospecting_contact_note',
      prospect_id: prospectId,
    })
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) databaseFailure('activity list failed', error, 'Contact notes are temporarily unavailable')

  return { activities: data ?? [] }
}

export async function saveProspectingContactNote(
  actor: AuthenticatedActor,
  rawInput: ProspectingContactNoteInput,
  database: ContactNoteDatabase = supabase,
) {
  const description = requiredText(rawInput.description, 'Note', 2_000)
  const contactKey = requiredText(rawInput.contactKey, 'Contact', 240)
  const contactName = requiredText(rawInput.contactName, 'Contact name', 160)
  const relation = optionalText(rawInput.relation, 80)
  const requestedLeadId = optionalText(rawInput.leadId, 80)
  const requestedProspectId = optionalText(rawInput.prospectId, 80)
  const campaignMemberId = optionalText(rawInput.campaignMemberId, 80)
  const dialerSessionId = optionalText(rawInput.dialerSessionId, 80)

  if (!requestedLeadId && !requestedProspectId && !campaignMemberId) {
    throw new ProspectingCampaignError('invalid_contact_note', 400, 'A Lead or source Prospect is required')
  }

  let leadId = requestedLeadId
  let prospectId = requestedProspectId
  let subjectKind: 'lead' | 'prospect' = requestedProspectId ? 'prospect' : 'lead'

  if (campaignMemberId) {
    const { data: member, error } = await database
      .from('prospecting_campaign_members')
      .select('id,subject_kind,lead_id,prospect_id')
      .eq('id', campaignMemberId)
      .maybeSingle()
    if (error) databaseFailure('member lookup failed', error)
    if (!member) throw new ProspectingCampaignError('campaign_member_not_found', 404, 'Campaign contact not found')

    const memberLeadId = typeof member.lead_id === 'string' ? member.lead_id : null
    const memberProspectId = typeof member.prospect_id === 'string' ? member.prospect_id : null
    if ((requestedLeadId && requestedLeadId !== memberLeadId) || (requestedProspectId && requestedProspectId !== memberProspectId)) {
      throw new ProspectingCampaignError('contact_note_subject_mismatch', 409, 'The selected contact no longer matches this calling session')
    }
    leadId = memberLeadId
    prospectId = memberProspectId
    subjectKind = member.subject_kind === 'prospect' ? 'prospect' : 'lead'
  } else if (prospectId) {
    const { data: prospect, error } = await database
      .from('prospects')
      .select('id,lead_id')
      .eq('id', prospectId)
      .maybeSingle()
    if (error) databaseFailure('prospect lookup failed', error)
    if (!prospect) throw new ProspectingCampaignError('prospect_not_found', 404, 'Source Prospect not found')
    leadId = typeof prospect.lead_id === 'string' ? prospect.lead_id : null
  }

  const metadata = {
    source: 'prospecting_contact_note',
    is_internal: true,
    subject_kind: subjectKind,
    prospect_id: prospectId,
    campaign_member_id: campaignMemberId,
    dialer_session_id: dialerSessionId,
    contact_key: contactKey,
    contact_name: contactName,
    relationship: relation,
  }

  const { data, error } = await database
    .from('lead_activities')
    .insert({
      lead_id: leadId,
      activity_type: 'note',
      description,
      agent: actor.name,
      metadata,
    })
    .select('id,lead_id,activity_type,description,agent,metadata,created_at')
    .single()
  if (error) databaseFailure('activity insert failed', error)

  return { activity: data }
}
