import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { ownerWorkspace, connectionMasterKey } from "../connections/service";
import { preferenceKeys } from "../preferences/service";
import { check, type Tx } from "../workflow/core";
import { emailWorkspaceConfigSchema } from "../config";
import { normalizePhoneToE164 } from '@/lib/phone-normalize';
import { leadSmsEnabled } from '../notifications/sms-provider';

export async function readHostedReadiness(tx: Tx, workspaceId: string) {
  const [workspace] =
    await tx`select config,send_enabled,execution_mode,revision,pause_reason from em_workspaces where id=${workspaceId}`;
  const config = emailWorkspaceConfigSchema.parse(workspace.config);
  const [counts] = await tx`select
 (select count(*)::int from em_service_connections where workspace_id=${workspaceId} and state='checked') as connections,
 (select count(*)::int from em_webhook_endpoints where workspace_id=${workspaceId} and active) as endpoints,
 (select count(*)::int from em_threads t join em_campaigns c on c.id=t.campaign_id where t.workspace_id=${workspaceId} and c.is_test
   and exists(select 1 from em_messages m where m.thread_id=t.id and m.transport='resend' and m.direction='inbound')
   and exists(select 1 from em_provider_events e where e.thread_id=t.id and e.type='email.delivered' and e.state='processed')) as complete_tests`;
  const blockers: string[] = [];
  if (workspace.execution_mode !== "hosted")
    blockers.push("Hosted workspace connection");
  if (!config.business?.address) blockers.push("Business mailing address");
  if (!config.team) blockers.push("Reviewer, acquisition owner and backup");
  if (config.team) {
    const ids = [
      config.team.reviewerId,
      config.team.acquisitionOwnerId,
      config.team.backupId,
    ];
    const active =
      await tx`select m.auth_user_id,p.phone,m.roles from em_memberships m join agent_profiles p on p.id=m.agent_profile_id
   and p.is_active is distinct from false and (p.user_id is null or p.user_id=m.auth_user_id)
   where m.workspace_id=${workspaceId} and m.auth_user_id=any(${tx.array(ids)}::uuid[]) and m.active`;
    if (ids.some((id) => !active.some((a) => a.auth_user_id === id)))
      blockers.push("Active assigned team members");
    const callbackIds = [config.team.acquisitionOwnerId, config.team.backupId];
    if (callbackIds[0] === callbackIds[1]) blockers.push('Separate callback owner and backup');
    if (callbackIds.some(id => !active.some(a => a.auth_user_id === id && a.roles.some((r: string) => ['owner','acquisitions'].includes(r)) && normalizePhoneToE164(a.phone))))
      blockers.push('Callback owner and backup need active acquisitions access and valid SMS numbers');
  }
  if (!counts.connections) blockers.push("Checked Resend connection");
  if (!counts.endpoints) blockers.push("Active reply webhook");
  if (!connectionMasterKey()) blockers.push("Encrypted credential storage");
  if (!Object.keys(preferenceKeys()).length || !process.env.EMAIL_PUBLIC_ORIGIN)
    blockers.push("Unsubscribe configuration");
  if (!counts.complete_tests)
    blockers.push("Delivered test email and received reply");
  if (process.env.EMAIL_RECEIVING_WORKER_ENABLED !== "true")
    blockers.push("Reply-processing worker");
  if (process.env.EMAIL_DISPATCH_WORKER_ENABLED !== "true")
    blockers.push("Sending worker");
  if (!leadSmsEnabled()) blockers.push('Lead SMS alerts');
  if (workspace.pause_reason)
    blockers.push(`Paused: ${workspace.pause_reason}`);
  return {
    ready: blockers.length === 0,
    blockers,
    sendingEnabled: workspace.send_enabled,
    revision: workspace.revision,
  };
}
export async function enableTestedSending(
  sql: Sql,
  subject: string,
  expectedRevision: number,
) {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject);
    const readiness = await readHostedReadiness(tx, ws.id);
    check(readiness.revision === expectedRevision, "STALE_SETTINGS");
    check(readiness.ready, "READINESS_REQUIRED");
    const tested =
      await tx`select distinct t.sender_id from em_threads t join em_campaigns c on c.id=t.campaign_id where t.workspace_id=${ws.id} and c.is_test
   and exists(select 1 from em_messages m where m.thread_id=t.id and m.direction='inbound' and m.transport='resend')
   and exists(select 1 from em_provider_events e where e.thread_id=t.id and e.type='email.delivered' and e.state='processed')`;
    const ids = tested.map((x) => x.sender_id).filter(Boolean);
    check(ids.length, "TESTED_SENDER_REQUIRED");
    await tx`update em_senders set state='active',revision=revision+1 where workspace_id=${ws.id} and id=any(${tx.array(ids)}::uuid[]) and state='paused'`;
    await tx`update em_domains set paused=false,revision=revision+1 where workspace_id=${ws.id} and id in (select domain_id from em_senders where workspace_id=${ws.id} and id=any(${tx.array(ids)}::uuid[])) and state='provider_verified'`;
    await tx`update em_workspaces set send_enabled=true,ai_auto_enabled=false,setup_completed_at=now(),revision=revision+1 where id=${ws.id}`;
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail) values(${ws.id},${subject},'SET-ENABLE-TESTED',${ws.id},${randomUUID()},${tx.json({senderIds:ids,aiAuto:false})})`;
    return { state: "sending_enabled", senderCount: ids.length };
  });
}
