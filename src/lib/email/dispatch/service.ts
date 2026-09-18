import { contactHygieneReasons } from '../hygiene/guards';
import { latestReplyMessageId } from '../inbound/routing';
import "server-only";
import type { Sql } from "postgres";
import { ownerWorkspace, connectionMasterKey } from "../connections/service";
import { decryptEmailSecret } from "../secrets";
import { check, workflowHash, type Tx } from "../workflow/core";
import {
  sendResendEmail,
  type FrozenResendPayload,
  type SendOutcome,
} from "../providers/resend";
import {
  pilotFollowUp,
  pilotFollowUpExpires,
  pilotSendSlot,
} from "../workflow/schedule";
import { projectCrmChanges } from "../crm-repairs";
import { queueIntent } from "../workflow/queue-intent";
import type { PilotConfig } from "../workflow/types";

/** One committed attempt per tick. Crashed/uncertain attempts require reconciliation. */
export async function processNextDispatch(
  sql: Sql,
  subject: string,
  options: {
    now?: Date;
    send?: typeof sendResendEmail;
    allowlistedTest?: string;
    intentId?: string;
  } = {},
) {
  const now = options.now ?? new Date(),
    key = connectionMasterKey();
  check(key, "CREDENTIAL_STORAGE_REQUIRED", 503);
  const claim = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject);
    const [workspace] =
      await tx`select execution_mode,send_enabled,pause_reason from em_workspaces where id=${ws.id}`;
    check(workspace.execution_mode === "hosted", "HOSTED_WORKSPACE_REQUIRED");
    if (
      workspace.pause_reason ||
      (!workspace.send_enabled && !options.allowlistedTest)
    )
      return null;
    const [intent] =
      await tx`select i.*,t.address_id,t.party_id,t.sender_id,t.content_revision,t.controller_revision,t.controller,t.inbound_pending,
      t.enrollment_id,v.config as campaign_config,t.state as thread_state,t.responsible_user_id,t.controller_user_id,c.state as campaign_state,
      s.state as sender_state,s.hourly_limit,s.daily_limit,d.paused as domain_paused,d.state as domain_state,
      d.last_verified_at,d.sending_state,d.receiving_state,cn.encrypted_secret,cn.state as connection_state,a.verification_state,a.verification_expires_at
      from em_send_intents i join em_threads t on t.workspace_id=i.workspace_id and t.id=i.thread_id
      join em_campaigns c on c.workspace_id=t.workspace_id and c.id=t.campaign_id
      join em_enrollments e on e.id=t.enrollment_id and e.workspace_id=t.workspace_id
      join em_campaign_versions v on v.id=e.campaign_version_id and v.workspace_id=e.workspace_id
      join em_senders s on s.workspace_id=t.workspace_id and s.id=t.sender_id
      join em_domains d on d.workspace_id=s.workspace_id and d.id=s.domain_id
      join em_service_connections cn on cn.workspace_id=i.workspace_id and cn.id=i.connection_id
      join em_addresses a on a.workspace_id=t.workspace_id and a.id=t.address_id
      where i.workspace_id=${ws.id} and i.state='queued' and i.not_before<=${now}
      and (${!options.allowlistedTest} or i.is_test)
      and (${options.intentId ?? null}::uuid is null or i.id=${options.intentId ?? null}::uuid)
      order by case when i.origin='human' then 0 else 1 end,i.not_before,i.id limit 1 for update of i`;
    if (!intent) return null;
    let payload = intent.provider_payload as FrozenResendPayload | null;
    if (
      options.allowlistedTest &&
      (!intent.is_test ||
        payload?.to.length !== 1 ||
        payload.to[0].toLowerCase() !== options.allowlistedTest.toLowerCase())
    )
      return null;
    if (!intent.is_test && pilotSendSlot(now).getTime() !== now.getTime())
      return null;
    const [restriction] =
      await tx`select id from em_suppressions where workspace_id=${ws.id} and address_id=${intent.address_id} limit 1`;
    const [active] =
      await tx`select m.auth_user_id from em_memberships m join agent_profiles p on p.id=m.agent_profile_id
      and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
      where m.workspace_id=${ws.id} and m.auth_user_id=${intent.responsible_user_id} and m.active
      and m.roles && array['owner','marketer','reviewer','acquisitions']::text[]`;
    const controllerActive =
      intent.controller !== "human" ||
      (
        await tx`select m.auth_user_id from em_memberships m
      join agent_profiles p on p.id=m.agent_profile_id and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
      where m.workspace_id=${ws.id} and m.auth_user_id=${intent.controller_user_id} and m.active
      and m.roles && array['owner','reviewer','acquisitions']::text[]`
      ).length > 0;
    const hygiene = await contactHygieneReasons(tx, { workspaceId: ws.id, partyId: intent.party_id, addressId: intent.address_id, now, threadId: intent.thread_id, sequence: intent.origin === "sequence", recontactDays: intent.campaign_config.recontactDays, ignoreOtherTestThreads: Boolean(intent.is_test && options.allowlistedTest) });
    const invalid =
      hygiene.length > 0 || restriction ||
      !active ||
      !controllerActive ||
      intent.inbound_pending ||
      ["stopped", "done"].includes(intent.thread_state) ||
      intent.expected_content_revision !== intent.content_revision ||
      intent.expected_controller_revision !== intent.controller_revision ||
      (intent.origin === "sequence" &&
        (intent.controller !== "none" || intent.campaign_state !== "active"));
    const unready =
      !payload ||
      workflowHash(payload) !== intent.provider_payload_hash ||
      workflowHash(intent.frozen_payload) !== intent.payload_hash ||
      intent.connection_state !== "checked" ||
      (intent.sender_state !== "active" &&
        !(
          intent.is_test &&
          options.allowlistedTest &&
          intent.sender_state === "paused"
        )) ||
      (intent.domain_paused && !(intent.is_test && options.allowlistedTest)) ||
      intent.sending_state !== "enabled" ||
      intent.receiving_state !== "enabled" ||
      intent.domain_state !== "provider_verified" ||
      !intent.last_verified_at ||
      new Date(intent.last_verified_at).getTime() <=
        now.getTime() - 86_400_000 ||
      intent.verification_state !== "valid" ||
      !intent.verification_expires_at ||
      new Date(intent.verification_expires_at) <= now ||
      new Date(intent.expires_at) <= now ||
      !intent.provider_idempotency_key;
    if (invalid || unready) {
      await tx`update em_send_intents set state=${invalid ? "cancelled" : "held"},cancellation_reason=${invalid ? "dispatch_guard" : "readiness_changed"} where id=${intent.id}`;
      return null;
    }
    // A follow-up can be queued before the provider reports the first message ID.
    // Freeze threading metadata only before the very first attempt; content stays unchanged.
    if (!intent.first_attempt_at && payload && !payload.headers['In-Reply-To']) {
      const parent = await latestReplyMessageId(tx, ws.id, intent.thread_id);
      if (!parent && intent.origin === 'sequence' && intent.step > 0) return null;
      if (parent) {
        payload = { ...payload, headers: { ...payload.headers, 'In-Reply-To': parent, References: parent } };
        await tx`update em_send_intents set provider_payload=${tx.json(payload)},provider_payload_hash=${workflowHash(payload)} where id=${intent.id}`;
      }
    }
    const [usage] =
      await tx`select count(*) filter(where first_attempt_at > ${new Date(now.getTime() - 3600000)})::int as hour,
      count(*)::int as day from em_send_intents where workspace_id=${ws.id} and first_attempt_at >=
      date_trunc('day',${now}::timestamptz at time zone 'America/Chicago') at time zone 'America/Chicago'`;
    if (
      usage.hour >=
        Math.min(intent.hourly_limit, intent.campaign_config.hourlyLimit, 2) ||
      usage.day >=
        Math.min(intent.daily_limit, intent.campaign_config.dailyLimit, 10)
    )
      return null;
    await tx`update em_send_intents set state='dispatching',first_attempt_at=${now},attempt_count=attempt_count+1 where id=${intent.id}`;
    return {
      intent,
      payload: payload!,
      workspaceId: ws.id as string,
      secret: decryptEmailSecret(
        intent.encrypted_secret,
        key,
        `${ws.id}/${intent.connection_id}/resend/1`,
      ),
    };
  });
  if (!claim) return { state: "idle", processed: 0 };
  let outcome: SendOutcome;
  try {
    outcome = await (options.send ?? sendResendEmail)(
      claim.secret,
      claim.payload,
      claim.intent.provider_idempotency_key,
    );
  } catch {
    outcome = { state: "uncertain", code: "RESEND_REQUEST_UNCERTAIN" };
  } finally {
    claim.secret = "";
  }
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx;
    await tx`select id from em_workspaces where id=${claim.workspaceId} for update`;
    const [current] =
      await tx`select state from em_send_intents where id=${claim.intent.id} and workspace_id=${claim.workspaceId} for update`;
    check(current?.state === "dispatching", "DISPATCH_STATE_CHANGED");
    await tx`update em_send_intents set state=${outcome.state},provider_message_id=${outcome.state === "accepted" ? outcome.providerId : null},
      remote_outcome=${outcome.state === "accepted" ? "provider_accepted" : outcome.code},accepted_at=${outcome.state === "accepted" ? now : null} where id=${claim.intent.id}`;
    if (outcome.state === "accepted") {
      const [thread] =
        await tx`select content_revision,inbound_pending,state from em_threads where id=${claim.intent.thread_id} and workspace_id=${claim.workspaceId} for update`;
      await tx`insert into em_messages(workspace_id,thread_id,intent_id,direction,text_body,subject,transport,event_key,content_hash,occurred_at,sequence,connection_id,provider_email_id)
        values(${claim.workspaceId},${claim.intent.thread_id},${claim.intent.id},'outbound',${claim.payload.text},${claim.payload.subject},'resend',${`intent:${claim.intent.id}`},${workflowHash(claim.payload)},${now},${thread.content_revision + 1},${claim.intent.connection_id},${outcome.providerId})`;
      await tx`update em_threads set content_revision=content_revision+1,last_message_at=${now},state=case when inbound_pending or state in ('stopped','done','needs_review') then state else 'waiting' end where id=${claim.intent.thread_id}`;
      await tx`update em_drafts set state='stale' where workspace_id=${claim.workspaceId} and thread_id=${claim.intent.thread_id} and state='current'`;
      if (
        !thread.inbound_pending &&
        !["stopped", "done", "needs_review"].includes(thread.state) &&
        claim.intent.origin === "sequence"
      ) {
        const config = claim.intent.campaign_config as PilotConfig;
        const due = pilotFollowUp(now);
        const expires = new Date(
          Math.min(
            pilotFollowUpExpires(now).getTime(),
            new Date(config.expiresAt).getTime(),
          ),
        );
        if (claim.intent.step === 0 && !claim.intent.is_test && expires > due) {
          try {
            await tx.savepoint(async (savepoint) => {
              await queueIntent(
                {
                  tx: savepoint as unknown as Tx,
                  now,
                  member: {
                    workspace_id: claim.workspaceId,
                    auth_user_id: subject,
                    roles: ["owner"],
                  },
                },
                {
                  threadId: claim.intent.thread_id,
                  key: `${claim.intent.enrollment_id}:1`,
                  body: config.steps[1].bodyTemplate,
                  subject: config.steps[1].subject,
                  step: 1,
                  origin: "sequence",
                  contentRevision: thread.content_revision + 1,
                  controllerRevision: claim.intent.controller_revision,
                  due,
                  expires,
                },
              );
              await (savepoint as unknown as Tx)`update em_enrollments set state='waiting_reply' where id=${claim.intent.enrollment_id}`;
            });
          } catch {
            // The provider already accepted the message. Preserve its receipt even
            // when a later configuration change prevents preparing the follow-up.
            await tx`update em_threads set state=case when state in ('stopped','done') then state else 'needs_review' end where id=${claim.intent.thread_id}`;
            await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
              values(${claim.workspaceId},${subject},'FOLLOWUP-PREPARATION-HELD',${claim.intent.thread_id},${claim.intent.id},${tx.json({ reason: "followup_preparation_failed" })},${now})`;
          }
        } else
          await tx`update em_enrollments set state='completed' where id=${claim.intent.enrollment_id}`;
      }
      if (!claim.intent.is_test)
        await projectCrmChanges(
          {
            tx,
            now,
            member: {
              workspace_id: claim.workspaceId,
              auth_user_id: subject,
              roles: ["owner"],
            },
          },
          claim.intent.thread_id,
          { history: true },
        );
    } else {
      await tx`update em_threads set state=case when state in ('stopped','done') then state else 'needs_review' end where id=${claim.intent.thread_id}`;
    }
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${claim.workspaceId},${subject},'RESEND-DISPATCH',${claim.intent.id},${claim.intent.id},${tx.json({ state: outcome.state, isTest: claim.intent.is_test })},${now})`;
    return {
      state: outcome.state,
      processed: 1,
      intentId: claim.intent.id as string,
    };
  });
}
