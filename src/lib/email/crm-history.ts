import "server-only";
import { check, workflowHash, type SuppressionContext } from "./workflow/core";

/** Canonical Lead history is the input to shared Conversations, including
 * mobile. Keep activity_type=email and an explicit direction for both clients. */
export async function projectThreadHistory(
  context: SuppressionContext,
  threadId: string,
  target?: { handoffId: string; leadId: string },
) {
  const { tx, member, now } = context;
  const [thread] =
    await tx`select t.lead_id,t.campaign_id,e.campaign_version_id,
    h.id as handoff_id,h.crm_sync_state
    from em_threads t
    join em_enrollments e on e.id=t.enrollment_id and e.workspace_id=t.workspace_id
    left join em_handoffs h on h.thread_id=t.id and h.workspace_id=t.workspace_id
    where t.workspace_id=${member.workspace_id} and t.id=${threadId}`;
  if (!target && (!thread?.lead_id || thread.crm_sync_state !== "synced"))
    return [];
  const leadId = target?.leadId ?? thread.lead_id;
  const handoffId = target?.handoffId ?? thread.handoff_id;
  check(
    thread?.lead_id === leadId && thread.handoff_id === handoffId,
    "CRM_HISTORY_LINK_CHANGED",
  );
  const messages = await tx`select m.* from em_messages m
    where m.workspace_id=${member.workspace_id} and m.thread_id=${threadId}
    order by m.sequence`;
  const projected: { messageId: string; activityId: string }[] = [];
  for (const message of messages) {
    const metadata = {
      source: "email_marketing",
      direction: message.direction,
      em_message_id: message.id,
      em_thread_id: threadId,
      em_handoff_id: handoffId,
      campaign_id: thread.campaign_id,
      campaign_version_id: thread.campaign_version_id,
      em_event_key: message.event_key,
      transport: message.transport,
      subject: message.subject,
      em_sequence: message.sequence,
      em_content_hash: message.content_hash,
    };
    const [inserted] = await tx`insert into lead_activities(
      lead_id,activity_type,description,agent,metadata,created_at
    ) values(${leadId},'email',${message.text_body},${null},${tx.json(metadata)},${message.occurred_at})
    on conflict do nothing returning id,lead_id,activity_type,description,metadata,created_at`;
    const [activity] = inserted
      ? [inserted]
      : await tx`select id,lead_id,activity_type,description,metadata,created_at from lead_activities
      where metadata->>'source'='email_marketing' and metadata->>'em_message_id'=${message.id}`;
    check(
      activity?.lead_id === leadId &&
        activity.activity_type === "email" &&
        activity.description === message.text_body &&
        workflowHash(activity.metadata) === workflowHash(metadata) &&
        new Date(activity.created_at).getTime() ===
          new Date(message.occurred_at).getTime(),
      "CRM_MESSAGE_PROJECTION_CONFLICT",
    );
    await tx`insert into em_crm_message_projections(
      workspace_id,handoff_id,thread_id,message_id,lead_id,lead_activity_id,direction,created_at
    ) values(${member.workspace_id},${handoffId},${threadId},${message.id},${leadId},${activity.id},${message.direction},${now})
    on conflict(message_id) do nothing`;
    const [receipt] =
      await tx`select lead_id,lead_activity_id,thread_id,handoff_id,direction from em_crm_message_projections
      where workspace_id=${member.workspace_id} and message_id=${message.id}`;
    check(
      receipt?.lead_id === leadId &&
        receipt.lead_activity_id === activity.id &&
        receipt.thread_id === threadId &&
        receipt.handoff_id === handoffId &&
        receipt.direction === message.direction,
      "CRM_MESSAGE_PROJECTION_CONFLICT",
    );
    projected.push({ messageId: message.id, activityId: activity.id });
  }
  return projected;
}

/** Hold only this feature's durable callback source row and its projection,
 * recording a work-item event in the same transaction as the Email hold. */
export async function holdCallbackTask(
  context: SuppressionContext,
  threadId: string,
  reason: string,
) {
  const { tx, member, now } = context;
  const [handoff] = await tx`select id,crm_task_id,crm_task_key from em_handoffs
    where workspace_id=${member.workspace_id} and thread_id=${threadId}`;
  if (!handoff?.crm_task_id) return;
  await tx`select pg_advisory_xact_lock(hashtextextended('work-item:' || ${handoff.crm_task_key},0))`;
  const [item] =
    await tx`select * from work_items where work_item_key=${handoff.crm_task_key} for update`;
  check(item?.source_id === handoff.crm_task_id, "CRM_CALLBACK_SOURCE_MISSING");
  if (["completed", "cancelled", "blocked"].includes(item.status)) return;
  const [source] =
    await tx`select metadata from lead_activities where id=${item.source_id} for update`;
  check(
    source?.metadata?.origin === "email_marketing" &&
      source.metadata.em_handoff_id === handoff.id,
    "CRM_CALLBACK_SOURCE_MISMATCH",
  );
  await tx`update lead_activities set metadata=metadata || ${tx.json({
    status: "blocked",
    email_hold_reason: reason,
    last_changed_by: member.auth_user_id,
    actor_type: member.auth_user_id ? "member" : "public_unsubscribe",
    last_changed_at: now.toISOString(),
  })} where id=${item.source_id}`;
  const [next] =
    await tx`select * from work_items where work_item_key=${item.work_item_key}`;
  check(next?.status === "blocked", "CRM_CALLBACK_HOLD_FAILED");
  await tx`insert into work_item_events(work_item_key,idempotency_key,action,actor,previous_state,next_state,metadata)
    values(${item.work_item_key},${`email-hold:${handoff.id}:${item.version}`},'email_hold',
    ${member.auth_user_id ?? "public_unsubscribe"},${tx.json(item)},${tx.json(next)},${tx.json({ reason, origin: "email_marketing" })})`;
}
