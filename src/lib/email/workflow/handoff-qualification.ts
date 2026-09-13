import 'server-only'
import type { EmailCommand } from '../contracts'
import {
  QUALIFICATION_PILLARS,
  evaluateQualification,
  leadRevisionFromUpdatedAt,
  type QualificationEvidenceRow,
  type QualificationPillar,
} from '../../qualification-policy-core'
import { check, json, type Context } from './core'

const ADVANCED = new Set([
  'qualified',
  'appointment_set',
  'offer_made',
  'under_contract',
  'closed_won',
])

/** Qualify only through the existing four-pillar policy and current Lead clock. */
export async function qualifyHandoff(
  context: Context,
  command: Extract<EmailCommand, { command: 'HAN-QUALIFY' }>,
) {
  const { tx, member, now } = context
  const p = command.payload
  check(
    member.roles.some((r) => ['owner', 'acquisitions'].includes(r)),
    'FORBIDDEN',
    403,
  )
  const [h] =
    await tx`select * from em_handoffs where workspace_id=${member.workspace_id} and id=${p.handoffId} for update`
  check(h, 'HANDOFF_NOT_FOUND', 404)
  check(h.revision === command.expectedRevision, 'HANDOFF_CHANGED')
  check(h.owner_id === member.auth_user_id, 'CALLBACK_OWNER_REQUIRED', 403)
  check(
    h.crm_sync_state === 'synced' &&
      h.lead_id === p.leadId &&
      h.state !== 'held' &&
      h.state !== 'completed',
    'CALLBACK_HELD',
  )
  const [repair] =
    await tx`select id from em_crm_projection_repairs where workspace_id=${member.workspace_id}
    and thread_id=${h.thread_id} and state='pending'`
  check(!repair, 'CALLBACK_HELD')
  const [lead] = await tx`select * from leads where id=${p.leadId} for update`
  check(lead, 'LEAD_NOT_FOUND', 404)
  const currentRevision = leadRevisionFromUpdatedAt(lead.updated_at)
  check(currentRevision !== null, 'LEAD_REVISION_UNAVAILABLE')
  check(
    Number.isFinite(Number(p.leadRevision)) &&
      Math.abs(currentRevision - Number(p.leadRevision)) < 2,
    'LEAD_CHANGED',
  )
  check(
    !lead.is_parked &&
      !['dead', 'closed_won', 'closed_lost'].includes(lead.station),
    'CRM_RECORD_HELD',
  )
  check(
    p.assessment.personAuthority.state === 'confirmed' &&
      p.assessment.personAuthority.evidenceIds.length > 0,
    'PERSON_AUTHORITY_REQUIRED',
  )
  const [property] =
    await tx`select cp.address from em_threads t
    join em_party_properties ep on ep.workspace_id=t.workspace_id and ep.party_id=t.party_id and ep.relationship='owner'
    join crm_properties cp on cp.id=ep.canonical_property_id
    where t.workspace_id=${member.workspace_id} and t.id=${h.thread_id}`
  const known = [lead.property_address, property?.address]
    .filter(Boolean)
    .map((value) => String(value).trim().toLowerCase())
  check(
    known.includes(p.assessment.propertyRef.trim().toLowerCase()),
    'PROPERTY_EVIDENCE_REQUIRED',
  )

  const evidenceIds = [
    ...p.evidenceIds,
    ...p.assessment.personAuthority.evidenceIds,
    ...QUALIFICATION_PILLARS.flatMap((pillar) => p.assessment[pillarKey(pillar)].evidenceIds),
  ]
  if (evidenceIds.length) {
    const unique = [...new Set(evidenceIds)]
    const messages =
      await tx`select id from em_messages where workspace_id=${member.workspace_id} and thread_id=${h.thread_id} and id=any(${tx.array(unique)}::uuid[])`
    check(messages.length === unique.length, 'EVIDENCE_CHANGED')
  }

  const pillars: Partial<Record<QualificationPillar, string>> = {}
  for (const pillar of QUALIFICATION_PILLARS) {
    const item = p.assessment[pillarKey(pillar)]
    const evidence = item.note?.trim() ?? ''
    if (item.state !== 'verified' || !evidence) continue
    pillars[pillar] = evidence
  }
  const preview = evaluateQualification(
    QUALIFICATION_PILLARS.map((pillar) => ({
      pillar,
      evidence: pillars[pillar] ?? null,
      status: pillars[pillar] ? 'verified' : 'needs_review',
    })),
  )
  check(preview.qualified, 'QUALIFICATION_INCOMPLETE')

  const [actor] =
    await tx`select u.email,a.full_name from em_memberships m
    join auth.users u on u.id=m.auth_user_id
    join agent_profiles a on a.id=m.agent_profile_id and a.is_active is distinct from false and (a.user_id is null or a.user_id=m.auth_user_id)
    where m.workspace_id=${member.workspace_id} and m.auth_user_id=${member.auth_user_id} and m.active`
  check(actor?.email && actor.full_name, 'ASSIGNEE_UNAVAILABLE')

  const saved = await tx`select save_crm_lead_qualification_v1(
    ${p.leadId}::uuid,${tx.json(json(pillars))}::jsonb,${actor.email},${actor.full_name}) as result`
  check(saved[0]?.result?.complete === true, 'QUALIFICATION_INCOMPLETE')

  const rows =
    await tx<QualificationEvidenceRow[]>`select pillar,evidence,status from crm_lead_qualification_pillars where lead_id=${p.leadId}`
  const status = evaluateQualification(rows)
  check(status.qualified, 'QUALIFICATION_INCOMPLETE')

  const preserved = ADVANCED.has(lead.station)
  if (!preserved) {
    check(lead.station === 'contacted', 'GOVERNED_TRANSITION_REQUIRED')
    await tx`update leads set station='qualified',classification='opportunity',priority='hot',updated_at=${now} where id=${p.leadId}`
  }
  await tx`insert into lead_activities(lead_id,activity_type,description,agent,metadata,created_at)
    values(${p.leadId},'status_change',${preserved ? `Qualification recorded; existing ${lead.station} stage preserved.` : 'Stage changed from contacted to qualified'},
    ${actor.full_name},${tx.json({
      origin: 'email_marketing',
      source: 'canonical_qualification_v1',
      em_handoff_id: h.id,
      why_worth_pursuing: p.assessment.whyWorthPursuing,
      next_action: p.nextAction,
      previous_station: lead.station,
      preserved,
    })},${now})`
  await tx`update em_handoffs set revision=revision+1,state='acknowledged' where id=${h.id}`
  if (h.crm_task_id) {
    await tx`update lead_activities set metadata=metadata || ${tx.json({
      title: p.nextAction,
      email_outcome: 'qualified',
      email_outcome_note: p.assessment.whyWorthPursuing,
      last_changed_by: member.auth_user_id,
      last_changed_at: now.toISOString(),
    })} where id=${h.crm_task_id}`
  }
  return {
    entityId: h.id,
    revision: h.revision + 1,
    state: preserved ? 'qualification_recorded' : 'opportunity_qualified',
    invalidates: [
      'email:workspace',
      'crm:conversations',
      'crm:work-items',
      `crm:lead:${p.leadId}`,
    ],
  }
}

function pillarKey(pillar: QualificationPillar) {
  return pillar.toLowerCase() as 'timeline' | 'condition' | 'motivation' | 'price'
}

export { leadRevisionFromUpdatedAt }
