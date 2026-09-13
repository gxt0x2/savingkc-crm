import 'server-only'

import { check, json, workflowHash, type Context } from './workflow/core'
import { pilotCallbackDue } from './workflow/schedule'
import { projectThreadHistory } from './crm-history'
import { emailWorkspaceConfigSchema } from './config'

export type LeadBridgeFacts = {
  positiveSellerInterest: boolean
  identityConfirmed: boolean
  propertyConfirmed: boolean
  existingStage?: string
}

export function leadBridgeDecision(facts: LeadBridgeFacts) {
  if (!facts.positiveSellerInterest) return 'NO_LEAD'
  if (!facts.identityConfirmed || !facts.propertyConfirmed) return 'REVIEW'
  if (
    [
      'qualified',
      'appointment_set',
      'offer_made',
      'under_contract',
      'closed_won',
    ].includes(facts.existingStage ?? '')
  )
    return 'PRESERVE_EXISTING'
  return 'CREATE_OR_LINK_LEAD'
}

type BridgeHoldReason =
  | 'seller_interest_unconfirmed'
  | 'identity_unconfirmed'
  | 'contact_identity_conflict'
  | 'property_unconfirmed'
  | 'property_ambiguous'
  | 'existing_record_held'
  | 'owner_conflict'
  | 'governed_transition_required'
  | 'canonical_dependency_missing'
  | 'schema_incompatible'

type BridgeInput = {
  handoffId: string
  threadId: string
  ownerId: string
  positiveSellerInterest: boolean
  evidenceMessageId: string
  evidenceQuote: string
  requestedContact: { phone?: string; requestedTimeText?: string }
}

type BridgeResult = {
  state:
    | 'handoff_saved_crm_synced'
    | 'handoff_saved_crm_review'
    | 'handoff_saved_crm_dependency_blocked'
  leadId?: string
  callbackTaskId?: string
}
type BridgeLead = {
  id: string
  station: string | null
  classification: string | null
  source: string | null
  assigned_agent: string | null
  is_parked: boolean
}

function normalized(value: unknown) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
}

async function holdBridge(
  context: Context,
  input: BridgeInput,
  requestHash: string,
  ownerName: string,
  reason: BridgeHoldReason,
  dependency = false,
): Promise<BridgeResult> {
  const { tx, member, now } = context
  await tx`update em_handoffs set state='held',
    crm_sync_state=${dependency ? 'dependency_unavailable' : 'review_required'},
    crm_sync_reason=${reason}
    where workspace_id=${member.workspace_id} and id=${input.handoffId}`
  await tx`insert into em_crm_handoff_projections(
      workspace_id,handoff_id,thread_id,evidence_message_id,request_hash,state,
      owner_auth_user_id,owner_name,hold_reason,created_at,completed_at
    ) values(
      ${member.workspace_id},${input.handoffId},${input.threadId},
      ${input.evidenceMessageId},${requestHash},'held',${input.ownerId},
      ${ownerName},${reason},${now},${now}
    ) on conflict(handoff_id) do update set
      state='held',hold_reason=excluded.hold_reason,completed_at=excluded.completed_at`
  return {
    state: dependency
      ? 'handoff_saved_crm_dependency_blocked'
      : 'handoff_saved_crm_review',
  }
}

/**
 * Projects a human-reviewed seller callback into canonical CRM records inside
 * the caller's Email command transaction. There is no provider or model I/O.
 * The bridge creates/links a Lead at contacted, projects Email history, and
 * creates a callback task. It never advances a Lead to Opportunity.
 */
export async function projectEmailHandoffToCrm(
  context: Context,
  input: BridgeInput,
): Promise<BridgeResult> {
  const { tx, member, now } = context
  const requestHash = workflowHash(input)
  // All bridge commands use this workspace lock; also hold the canonical
  // person and existing Lead rows while validating against other CRM writers.
  const [handoff] = await tx`select * from em_handoffs
    where workspace_id=${member.workspace_id} and id=${input.handoffId} for update`
  check(
    handoff &&
      handoff.thread_id === input.threadId &&
      handoff.owner_id === input.ownerId &&
      handoff.seller_interest_confirmed === input.positiveSellerInterest &&
      workflowHash(handoff.requested_contact) ===
        workflowHash(input.requestedContact) &&
      handoff.fact_evidence.length === 1 &&
      handoff.fact_evidence[0].messageId === input.evidenceMessageId &&
      handoff.fact_evidence[0].quote === input.evidenceQuote,
    'CRM_HANDOFF_CHANGED',
  )
  const [owner] = await tx`select p.full_name from em_memberships m
      join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
      where m.workspace_id=${member.workspace_id}
        and m.auth_user_id=${input.ownerId} and m.active`
  const [actor] = await tx`select p.full_name from em_memberships m
      join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
      where m.workspace_id=${member.workspace_id}
        and m.auth_user_id=${member.auth_user_id} and m.active`
  check(owner?.full_name && actor?.full_name, 'ASSIGNEE_UNAVAILABLE')

  const [thread] =
    await tx`select t.party_id,t.address_id,t.campaign_id,t.enrollment_id,t.subject,
      p.kind,p.identity_state,p.lead_id as party_lead_id,
      p.canonical_person_id,p.display_name,a.normalized_address
    from em_threads t
    join em_parties p on p.workspace_id=t.workspace_id and p.id=t.party_id
    join em_addresses a on a.workspace_id=t.workspace_id and a.id=t.address_id
    where t.workspace_id=${member.workspace_id} and t.id=${input.threadId} for update of p,a`
  check(thread, 'THREAD_NOT_FOUND', 404)
  const [evidence] =
    await tx`select id,text_body,direction,occurred_at from em_messages
    where workspace_id=${member.workspace_id} and thread_id=${input.threadId} and id=${input.evidenceMessageId}`
  check(
    evidence?.direction === 'inbound' &&
      evidence.text_body.includes(input.evidenceQuote),
    'EVIDENCE_CHANGED',
  )

  await tx`insert into em_crm_handoff_projections(
      workspace_id,handoff_id,thread_id,evidence_message_id,request_hash,state,
      owner_auth_user_id,owner_name,created_at
    ) values(
      ${member.workspace_id},${input.handoffId},${input.threadId},
      ${input.evidenceMessageId},${requestHash},'pending',${input.ownerId},
      ${owner.full_name},${now}
    ) on conflict(handoff_id) do nothing`
  const [ledger] =
    await tx`select request_hash,state,lead_id,work_item_id from em_crm_handoff_projections
      where workspace_id=${member.workspace_id} and handoff_id=${input.handoffId}
      for update`
  check(ledger?.request_hash === requestHash, 'CRM_BRIDGE_IDEMPOTENCY_MISMATCH')
  if (ledger.state === 'synced')
    return {
      state: 'handoff_saved_crm_synced',
      leadId: ledger.lead_id,
      callbackTaskId: ledger.work_item_id,
    }

  const [dependencies] = await tx`select
    to_regprocedure('public.refresh_crm_entity_for_lead(uuid)') is not null as refresh_ready,
    to_regprocedure('public.create_work_item_v2(text,text,uuid,text,text,text,timestamptz,text,text,text,text,boolean,jsonb)') is not null as task_ready,
    exists(select 1 from pg_trigger where tgrelid='public.leads'::regclass
      and tgname='guard_email_crm_identity_on_lead_insert' and tgenabled in ('O','A')) as identity_guard_ready`
  if (
    !dependencies?.refresh_ready ||
    !dependencies?.task_ready ||
    !dependencies?.identity_guard_ready
  )
    return holdBridge(
      context,
      input,
      requestHash,
      owner.full_name,
      'canonical_dependency_missing',
      true,
    )

  if (!input.positiveSellerInterest)
    return holdBridge(
      context,
      input,
      requestHash,
      owner.full_name,
      'seller_interest_unconfirmed',
    )
  if (
    thread.kind !== 'seller' ||
    thread.identity_state !== 'confirmed' ||
    !thread.canonical_person_id
  )
    return holdBridge(
      context,
      input,
      requestHash,
      owner.full_name,
      'identity_unconfirmed',
    )

  const addressLinks =
    await tx`select party_id,relationship from em_party_addresses
    where workspace_id=${member.workspace_id} and address_id=${thread.address_id}
      and relationship in ('confirmed','shared') for share`
  if (
    addressLinks.length !== 1 ||
    addressLinks[0].relationship !== 'confirmed' ||
    addressLinks[0].party_id !== thread.party_id
  )
    return holdBridge(
      context,
      input,
      requestHash,
      owner.full_name,
      'contact_identity_conflict',
    )

  const properties =
    await tx`select ep.canonical_property_id,cp.address,cp.city,cp.state,cp.zip,
      cp.county,cp.parcel_id,cp.property_type,cp.bedrooms,cp.bathrooms,cp.sqft,
      cp.year_built
    from em_party_properties ep
    join crm_properties cp on cp.id=ep.canonical_property_id
    where ep.workspace_id=${member.workspace_id} and ep.party_id=${thread.party_id}
      and ep.relationship in ('owner','representative')
      and ep.canonical_property_id is not null for share of ep,cp`
  if (properties.length === 0)
    return holdBridge(
      context,
      input,
      requestHash,
      owner.full_name,
      'property_unconfirmed',
    )
  if (properties.length !== 1)
    return holdBridge(
      context,
      input,
      requestHash,
      owner.full_name,
      'property_ambiguous',
    )
  const property = properties[0]
  await tx`select pg_advisory_xact_lock(hashtextextended(
    ${`email-crm-identity:${thread.canonical_person_id}:${property.canonical_property_id}`},0))`
  const [person] =
    await tx`select record_status from crm_people where id=${thread.canonical_person_id} for update`
  if (person?.record_status !== 'active')
    return holdBridge(
      context,
      input,
      requestHash,
      owner.full_name,
      'identity_unconfirmed',
    )
  await tx`select pg_advisory_xact_lock(hashtextextended('crm-entity-person:' || ${thread.canonical_person_id},0))`

  const [contactMethod] = await tx`select id from crm_contact_methods
      where person_id=${thread.canonical_person_id} and method_type='email'
        and lower(normalized_value)=lower(${thread.normalized_address}) for share`
  if (!contactMethod)
    return holdBridge(
      context,
      input,
      requestHash,
      owner.full_name,
      'contact_identity_conflict',
    )

  let lead: BridgeLead | undefined
  let created = false
  if (thread.party_lead_id) {
    const [linked] = await tx<
      (BridgeLead & { person_id: string; property_id: string | null })[]
    >`select l.id,l.station,l.classification,l.source,l.assigned_agent,
        l.is_parked,link.person_id,link.property_id
      from leads l join crm_lead_entity_links link on link.lead_id=l.id
      where l.id=${thread.party_lead_id} for update of l`
    if (
      !linked ||
      linked.person_id !== thread.canonical_person_id ||
      linked.property_id !== property.canonical_property_id
    )
      return holdBridge(
        context,
        input,
        requestHash,
        owner.full_name,
        'contact_identity_conflict',
      )
    lead = linked
  } else {
    const candidates = await tx<
      BridgeLead[]
    >`select l.id,l.station,l.classification,l.source,l.assigned_agent,l.is_parked
      from crm_lead_entity_links link join leads l on l.id=link.lead_id
      where link.person_id=${thread.canonical_person_id}
        and link.property_id=${property.canonical_property_id}
      order by l.created_at,l.id for update of l`
    if (candidates.length > 1)
      return holdBridge(
        context,
        input,
        requestHash,
        owner.full_name,
        'property_ambiguous',
      )
    lead = candidates[0]
  }

  if (lead) {
    const [otherParty] =
      await tx`select id from em_parties where workspace_id=${member.workspace_id}
        and lead_id=${lead.id} and id<>${thread.party_id}`
    if (otherParty)
      return holdBridge(
        context,
        input,
        requestHash,
        owner.full_name,
        'contact_identity_conflict',
      )
    if (
      lead.is_parked ||
      ['closed_won', 'closed_lost', 'dead'].includes(lead.station ?? '') ||
      lead.classification === 'dead'
    )
      return holdBridge(
        context,
        input,
        requestHash,
        owner.full_name,
        'existing_record_held',
      )
    if (
      ![
        'contacted',
        'qualified',
        'appointment_set',
        'offer_made',
        'under_contract',
      ].includes(lead.station ?? '')
    )
      return holdBridge(
        context,
        input,
        requestHash,
        owner.full_name,
        'governed_transition_required',
      )
    if (
      !lead.assigned_agent ||
      normalized(lead.assigned_agent) !== normalized(owner.full_name)
    )
      return holdBridge(
        context,
        input,
        requestHash,
        owner.full_name,
        'owner_conflict',
      )
  } else {
    const [inserted] = await tx<BridgeLead[]>`insert into leads(
        full_name,phone,email,property_address,city,state,zip,county,parcel_id,
        property_type,bedrooms,bathrooms,sqft,year_built,source,station,
        classification,priority,assigned_agent,is_parked
      ) values(
        ${thread.display_name},${null},${thread.normalized_address},
        ${property.address},${property.city},${property.state},${property.zip},
        ${property.county},${property.parcel_id},${property.property_type},
        ${property.bedrooms},${property.bathrooms},${property.sqft},
        ${property.year_built},'email_marketing','contacted','lead','warm',
        ${owner.full_name},false
      ) returning id,station,classification,source,assigned_agent,is_parked`
    check(inserted, 'CRM_LEAD_CREATE_FAILED')
    await tx`select refresh_crm_entity_for_lead(${inserted.id})`
    const [canonicalLink] =
      await tx`select person_id,property_id from crm_lead_entity_links
        where lead_id=${inserted.id}`
    check(
      canonicalLink?.person_id === thread.canonical_person_id &&
        canonicalLink?.property_id === property.canonical_property_id,
      'CRM_CANONICAL_PROJECTION_MISMATCH',
    )
    lead = inserted
    created = true
  }

  check(lead, 'CRM_LEAD_CREATE_FAILED')
  await tx`update em_parties set lead_id=${lead.id}
    where workspace_id=${member.workspace_id} and id=${thread.party_id}`
  await tx`update em_threads set lead_id=${lead.id}
    where workspace_id=${member.workspace_id} and id=${input.threadId}`

  const [enrollment] = await tx`select campaign_version_id from em_enrollments
      where workspace_id=${member.workspace_id} and id=${thread.enrollment_id}`
  check(enrollment?.campaign_version_id, 'CRM_CAMPAIGN_CONTEXT_MISSING')
  const projections = await projectThreadHistory(context, input.threadId, {
    handoffId: input.handoffId,
    leadId: lead.id,
  })
  const evidenceActivityId = projections.find(
    (p) => p.messageId === input.evidenceMessageId,
  )?.activityId
  check(evidenceActivityId, 'CRM_EVIDENCE_PROJECTION_MISSING')
  await tx`insert into em_attribution_touches(
    workspace_id,handoff_id,thread_id,message_id,party_id,lead_id,campaign_id,
    campaign_version_id,event_type,occurred_at,created_at
  ) values(
    ${member.workspace_id},${input.handoffId},${input.threadId},
    ${input.evidenceMessageId},${thread.party_id},${lead.id},
    ${thread.campaign_id},${enrollment.campaign_version_id},'seller_interest',
    ${evidence.occurred_at},${now}
  ) on conflict(message_id,event_type) do nothing`
  const [attribution] = await tx`select * from em_attribution_touches
    where workspace_id=${member.workspace_id} and message_id=${input.evidenceMessageId} and event_type='seller_interest'`
  check(
    attribution?.lead_id === lead.id &&
      attribution.handoff_id === input.handoffId &&
      attribution.thread_id === input.threadId &&
      attribution.party_id === thread.party_id &&
      attribution.campaign_id === thread.campaign_id &&
      attribution.campaign_version_id === enrollment.campaign_version_id &&
      new Date(attribution.occurred_at).getTime() ===
        new Date(evidence.occurred_at).getTime(),
    'CRM_ATTRIBUTION_CONFLICT',
  )

  const [workspace] =
    await tx`select config from em_workspaces where id=${member.workspace_id}`
  const team = emailWorkspaceConfigSchema.parse(workspace.config).team
  const callbackDue = pilotCallbackDue(now, team)
  const phoneText = input.requestedContact.phone ?? 'not provided'
  const requestedTime =
    input.requestedContact.requestedTimeText ?? 'not provided'
  const notes = [
    'Seller requested a callback by email.',
    `Phone provided: ${phoneText}`,
    `Seller's requested time: ${requestedTime}`,
    `Message evidence: ${input.evidenceQuote}`,
    'Due time is the deadline to review this request, not a promised call time. Confirm a suitable time before calling.',
  ].join('\n')
  const taskKey = `email-handoff:${input.handoffId}:callback`
  const [taskCall] = await tx`select create_work_item_v2(
    ${actor.full_name},${taskKey},${lead.id},'callback',
    ${`Review callback request from ${thread.display_name}`},${notes},
    ${callbackDue},${owner.full_name},'acquisitions','acquisitions','high',false,
    ${tx.json(
      json({
        origin: 'email_marketing',
        em_handoff_id: input.handoffId,
        em_thread_id: input.threadId,
        em_message_id: input.evidenceMessageId,
        campaign_id: thread.campaign_id,
        campaign_version_id: enrollment.campaign_version_id,
        requested_phone: input.requestedContact.phone,
        requested_time_text: input.requestedContact.requestedTimeText,
        evidence_quote: input.evidenceQuote,
        bridge_request_hash: requestHash,
        lead_created: created,
        due_purpose: 'callback_review_sla',
      }),
    )}
  ) as result`
  const workItem = taskCall?.result?.workItem as
    | {
        source_id?: string
        work_item_key?: string
        lead_id?: string
        assigned_to?: string
        source_metadata?: {
          em_handoff_id?: string
          bridge_request_hash?: string
        }
      }
    | undefined
  check(workItem?.source_id && workItem.work_item_key, 'CRM_TASK_CREATE_FAILED')
  check(
    workItem.lead_id === lead.id &&
      normalized(workItem.assigned_to) === normalized(owner.full_name) &&
      workItem.source_metadata?.em_handoff_id === input.handoffId &&
      workItem.source_metadata?.bridge_request_hash === requestHash,
    'CRM_TASK_REPLAY_CONFLICT',
  )

  await tx`update em_handoffs set lead_id=${lead.id},crm_task_id=${workItem.source_id},
    crm_task_key=${workItem.work_item_key},callback_due_at=${callbackDue},
    crm_sync_state='synced',crm_sync_reason=null,crm_synced_at=${now}
    where workspace_id=${member.workspace_id} and id=${input.handoffId}`
  await tx`update em_crm_handoff_projections set state='synced',lead_id=${lead.id},
    lead_activity_id=${evidenceActivityId},work_item_id=${workItem.source_id},
    work_item_key=${workItem.work_item_key},hold_reason=null,completed_at=${now}
    where workspace_id=${member.workspace_id} and handoff_id=${input.handoffId}`

  return {
    state: 'handoff_saved_crm_synced',
    leadId: lead.id,
    callbackTaskId: workItem.source_id,
  }
}
