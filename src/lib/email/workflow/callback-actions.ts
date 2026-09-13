import 'server-only'
import { check, type Context } from './core'

/** Mutate the canonical durable activity, then verify its task projection. */
export async function changeCallback(
  context: Context,
  handoffId: string,
  revision: number | undefined,
  change: { dueAt?: Date; completeNote?: string; accept?: boolean },
  key: string,
) {
  const { tx, member, now } = context
  const [h] = await tx`select h.*,t.state as thread_state from em_handoffs h
    join em_threads t on t.id=h.thread_id and t.workspace_id=h.workspace_id
    where h.workspace_id=${member.workspace_id} and h.id=${handoffId} for update of h`
  check(h && h.owner_id === member.auth_user_id, 'CALLBACK_OWNER_REQUIRED', 403)
  check(revision !== undefined && revision === h.revision, 'HANDOFF_CHANGED')
  check(
    h.crm_sync_state === 'synced' &&
      h.state !== 'held' &&
      h.state !== 'completed' &&
      !['stopped', 'done'].includes(h.thread_state),
    'CALLBACK_HELD',
  )
  const [repair] =
    await tx`select id from em_crm_projection_repairs where workspace_id=${member.workspace_id}
    and thread_id=${h.thread_id} and state='pending'`
  check(!repair, 'CALLBACK_HELD')
  await tx`select pg_advisory_xact_lock(hashtextextended('work-item:' || ${h.crm_task_key},0))`
  const [item] =
    await tx`select * from work_items where work_item_key=${h.crm_task_key} for update`
  const [source] =
    await tx`select * from lead_activities where id=${h.crm_task_id} for update`
  check(
    item?.status === 'pending' &&
      item.source_id === h.crm_task_id &&
      source?.lead_id === h.lead_id &&
      source.metadata?.em_handoff_id === h.id &&
      source.metadata?.origin === 'email_marketing',
    'CALLBACK_HELD',
  )
  const [owner] =
    await tx`select p.full_name from em_memberships m join agent_profiles p on p.id=m.agent_profile_id
    where m.workspace_id=${member.workspace_id} and m.auth_user_id=${member.auth_user_id} and m.active`
  const [lead] =
    await tx`select assigned_agent from leads where id=${h.lead_id} for update`
  check(
    owner?.full_name &&
      lead?.assigned_agent === owner.full_name &&
      item.assigned_to === owner.full_name,
    'CALLBACK_OWNER_CHANGED',
  )
  const metadata = {
    ...(change.dueAt
      ? { due_date: change.dueAt.toISOString(), email_manual_follow_up: true }
      : {}),
    ...(change.completeNote
      ? {
          status: 'completed',
          completed_at: now.toISOString(),
          completion_note: change.completeNote,
        }
      : {}),
    last_changed_by: member.auth_user_id,
    last_changed_at: now.toISOString(),
  }
  await tx`update lead_activities set metadata=metadata || ${tx.json(metadata)} where id=${h.crm_task_id}`
  const [next] =
    await tx`select * from work_items where work_item_key=${h.crm_task_key}`
  check(
    next?.status === (change.completeNote ? 'completed' : 'pending') &&
      (!change.dueAt ||
        new Date(next.due_at).getTime() === change.dueAt.getTime()),
    'CRM_CALLBACK_UPDATE_FAILED',
  )
  await tx`insert into work_item_events(work_item_key,idempotency_key,action,actor,previous_state,next_state,metadata)
    values(${h.crm_task_key},${key},${change.completeNote ? 'complete' : change.dueAt ? 'reschedule' : 'accept'},
      ${member.auth_user_id},${tx.json(item)},${tx.json(next)},${tx.json({ origin: 'email_marketing' })})`
  await tx`update em_handoffs set revision=revision+1,state=${change.completeNote ? 'completed' : 'acknowledged'},
    scheduled_for=${change.dueAt ?? (change.completeNote ? null : h.scheduled_for)},
    callback_due_at=${change.dueAt ?? h.callback_due_at} where id=${h.id}`
  if (change.completeNote) {
    await tx`insert into lead_activities(lead_id,activity_type,description,agent,metadata,created_at)
      values(${h.lead_id},'note',${change.completeNote},${owner.full_name},${tx.json({ origin: 'email_marketing', em_thread_id: h.thread_id })},${now})`
    await tx`update em_threads set state='done' where workspace_id=${member.workspace_id} and id=${h.thread_id}`
  } else if (change.dueAt) {
    await tx`update em_threads set state='waiting' where workspace_id=${member.workspace_id} and id=${h.thread_id}`
  }
  return {
    entityId: h.id,
    revision: h.revision + 1,
    state: change.completeNote
      ? 'callback_completed'
      : change.dueAt
        ? 'callback_scheduled'
        : 'callback_accepted',
  }
}
