import "server-only";
import { selectInitialAddresses } from "../hygiene/guards";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { z } from "zod";
import { ownerWorkspace } from "../connections/service";
import { queueIntent } from "../workflow/queue-intent";
import { check, workflowHash, type Tx } from "../workflow/core";
import type { PilotConfig } from "../workflow/types";

export const controlledTestSchema = z
  .object({
    senderId: z.string().uuid(),
    idempotencyKey: z.string().uuid(),
    campaignId: z.string().uuid().optional(),
  })
  .strict();
/** A real test has its own records and can only target the operator allowlist. */
export async function queueControlledTest(
  sql: Sql,
  subject: string,
  raw: unknown,
  now = new Date(),
) {
  const input = controlledTestSchema.parse(raw);
  const recipient =
    process.env.EMAIL_CONTROLLED_RECIPIENT?.trim().toLowerCase();
  check(
    z.string().email().safeParse(recipient).success,
    "CONTROLLED_RECIPIENT_REQUIRED",
    503,
  );
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject);
    const [workspace] =
      await tx`select execution_mode from em_workspaces where id=${ws.id}`;
    check(workspace.execution_mode === "hosted", "HOSTED_WORKSPACE_REQUIRED");
    const hash = workflowHash({ ...input, recipient });
    const [prior] =
      await tx`select payload_hash,result from em_command_receipts where workspace_id=${ws.id} and actor_id=${subject} and idempotency_key=${input.idempotencyKey}`;
    if (prior) {
      check(prior.payload_hash === hash, "IDEMPOTENCY_MISMATCH");
      return prior.result as {
        entityId: string;
        threadId: string;
        recipient: string;
        state: string;
      };
    }
    const [sender] =
      await tx`select id from em_senders where workspace_id=${ws.id} and id=${input.senderId}`;
    check(sender, "SENDER_NOT_FOUND", 404);
    const [sourceCampaign] = input.campaignId
      ? await tx`select name,draft_config from em_campaigns where workspace_id=${ws.id} and id=${input.campaignId} and state='draft' and not is_test`
      : [];
    if (input.campaignId) check(sourceCampaign, "CAMPAIGN_NOT_FOUND", 404);
    const sourceConfig = sourceCampaign
      ? (sourceCampaign.draft_config as PilotConfig)
      : null;
    if (sourceConfig) {
      check(sourceConfig.senderIds.includes(input.senderId), "SENDER_MISMATCH", 400);
      check(sourceConfig.steps.length === 2, "SAVE_SEQUENCE_FIRST", 400);
    }
    const [address] =
      await tx`insert into em_addresses(workspace_id,raw_address,normalized_address,verification_state,verification_expires_at)
      values(${ws.id},${recipient!},${recipient!},'valid',${new Date(now.getTime() + 86_400_000)})
      on conflict(workspace_id,normalized_address) do update set verification_state='valid',verification_expires_at=excluded.verification_expires_at returning id`;
    const [stopped] =
      await tx`select id from em_suppressions where workspace_id=${ws.id} and address_id=${address.id}`;
    check(!stopped, "RECIPIENT_UNSUBSCRIBED");
    const existingPeople = await tx`select p.id,pa.relationship from em_party_addresses pa join em_parties p on p.workspace_id=pa.workspace_id and p.id=pa.party_id where pa.workspace_id=${ws.id} and pa.address_id=${address.id} and pa.relationship in ('confirmed','shared')`;
    check(existingPeople.length <= 1 && (!existingPeople[0] || existingPeople[0].relationship === 'confirmed'), 'CONTROLLED_IDENTITY_REVIEW');
    const party = existingPeople[0] ?? (await tx`insert into em_parties(workspace_id,display_name,kind,identity_state,identity_evidence)
      values(${ws.id},'Controlled test recipient','seller','confirmed','{"source":"owner-authorized controlled test; not a seller lead"}'::jsonb) returning id`)[0];
    await tx`insert into em_party_addresses(workspace_id,party_id,address_id,relationship,confirmed_at,evidence)
      values(${ws.id},${party.id},${address.id},'confirmed',${now},'{"source":"owner-authorized test"}'::jsonb) on conflict do nothing`;
    await selectInitialAddresses(tx, ws.id, party.id);
    const [audience] =
      await tx`insert into em_audiences(workspace_id,name,program,state) values(${ws.id},'Controlled delivery test','seller_outreach','ready') returning id`;
    const [snapshot] =
      await tx`insert into em_audience_snapshots(workspace_id,audience_id,source_revision,content_hash,row_count,eligible_count)
      values(${ws.id},${audience.id},1,${hash},1,1) returning id`;
    await tx`insert into em_snapshot_rows(workspace_id,snapshot_id,party_id,address_id,eligibility,evidence_hash)
      values(${ws.id},${snapshot.id},${party.id},${address.id},'eligible',${hash})`;
    const text = sourceConfig?.steps[0].bodyTemplate ??
      "Ernest, this is the controlled SavingKC Email setup test you approved. Please reply to this message so we can verify that your response appears in the CRM. This is a system test, not a property inquiry.";
    const subjectLine = sourceConfig?.steps[0].subject ??
      "SavingKC Email — controlled setup test";
    const config: PilotConfig = {
      audienceId: audience.id,
      senderIds: [sender.id],
      playbookVersionId: randomUUID(),
      mode: "draft_only",
      copyMode: "template",
      draftGenerationBudget: 0,
      steps: [
        {
          id: randomUUID(),
          delayMinCalendarDays: 0,
          delayMaxCalendarDays: 0,
          targetCalendarDay: 0,
          subject: subjectLine,
          bodyTemplate: text,
        },
        {
          id: randomUUID(),
          delayMinCalendarDays: 7,
          delayMaxCalendarDays: 10,
          targetCalendarDay: 8,
          subject: "Test follow-up (disabled)",
          bodyTemplate: "No automatic follow-up is sent for this test.",
        },
      ],
      timezone: "America/Chicago",
      weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
      startLocal: "09:00",
      endLocal: "17:00",
      hourlyLimit: 2,
      dailyLimit: 10,
      maxRecipients: 1,
      dailyCostCap: 0,
      totalCostCap: 0,
      recontactDays: 90,
      expiresAt: new Date(now.getTime() + 3600000).toISOString(),
      replyActions: [],
      requiredPermissionBasis: "Explicit owner-approved controlled test",
    };
    const [campaign] =
      await tx`insert into em_campaigns(workspace_id,name,program,owner_id,state,draft_config,is_test) values(${ws.id},${sourceCampaign ? `Sample: ${sourceCampaign.name}` : 'Controlled setup test'},'seller_outreach',${subject},'draft',${tx.json(config)},true) returning id`;
    const [version] =
      await tx`insert into em_campaign_versions(workspace_id,campaign_id,version_number,snapshot_id,playbook_version_id,config,content_hash,review_hash,published_by)
      values(${ws.id},${campaign.id},1,${snapshot.id},${config.playbookVersionId},${tx.json(config)},${workflowHash(config)},${hash},${subject}) returning id`;
    await tx`update em_campaigns set state='active',active_version_id=${version.id} where id=${campaign.id}`;
    const [enrollment] =
      await tx`insert into em_enrollments(workspace_id,campaign_id,campaign_version_id,party_id,address_id)
      values(${ws.id},${campaign.id},${version.id},${party.id},${address.id}) returning id`;
    const [thread] =
      await tx`insert into em_threads(workspace_id,campaign_id,enrollment_id,address_id,party_id,subject,responsible_user_id,sender_id)
      values(${ws.id},${campaign.id},${enrollment.id},${address.id},${party.id},${config.steps[0].subject},${subject},${sender.id}) returning id`;
    const entityId = await queueIntent(
      {
        tx,
        now,
        member: {
          workspace_id: ws.id,
          auth_user_id: subject,
          roles: ["owner"],
        },
      },
      {
        threadId: thread.id,
        key: `${enrollment.id}:0`,
        body: text,
        subject: config.steps[0].subject,
        step: 0,
        origin: "sequence",
        contentRevision: 0,
        controllerRevision: 0,
        due: now,
        expires: new Date(now.getTime() + 3600000),
      },
    );
    const result = {
      entityId,
      threadId: thread.id as string,
      recipient: recipient!,
      state: "test_queued",
    };
    await tx`insert into em_command_receipts(workspace_id,actor_id,idempotency_key,command,payload_hash,result)
      values(${ws.id},${subject},${input.idempotencyKey},'CONTROLLED-TEST',${hash},${tx.json(result)})`;
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
      values(${ws.id},${subject},'CONTROLLED-TEST',${entityId},${input.idempotencyKey},${tx.json({ isTest: true, senderId: sender.id, recipient })},${now})`;
    return result;
  });
}
