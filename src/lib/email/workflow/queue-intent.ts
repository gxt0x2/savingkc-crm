import "server-only";
import { freezeHostedEnvelope } from "../providers/frozen-envelope";
import { check, workflowHash, type Context } from "./core";

export async function queueIntent(
  context: Context,
  input: {
    threadId: string;
    key: string;
    body: string;
    subject: string;
    step: number;
    origin: "sequence" | "human";
    contentRevision: number;
    controllerRevision: number;
    due: Date;
    expires: Date;
  },
) {
  const [workspace] =
    await context.tx`select execution_mode from em_workspaces where id=${context.member.workspace_id}`;
  if (workspace.execution_mode === "hosted") {
    const [unresolved] =
      await context.tx`select id from em_send_intents where workspace_id=${context.member.workspace_id} and thread_id=${input.threadId} and state in ('dispatching','uncertain') limit 1`;
    check(!unresolved, "DELIVERY_RECONCILIATION_REQUIRED");
  }
  const hosted =
    workspace.execution_mode === "hosted"
      ? await freezeHostedEnvelope(
          context,
          input.threadId,
          input.body,
          input.subject,
        )
      : null;
  const payload = {
    body: input.body,
    subject: input.subject,
    from: hosted?.payload.from ?? "team@outreach.savingkc.test",
    transport: hosted ? "resend" : "simulation",
  };
  const [intent] =
    await context.tx`insert into em_send_intents(workspace_id,thread_id,logical_key,origin,step,frozen_payload,payload_hash,
    expected_content_revision,expected_controller_revision,not_before,expires_at)
    values(${context.member.workspace_id},${input.threadId},${input.key},${input.origin},${input.step},${context.tx.json(payload)},${workflowHash(payload)},
    ${input.contentRevision},${input.controllerRevision},${input.due},${input.expires}) returning id`;
  if (hosted)
    await context.tx`update em_send_intents set connection_id=${hosted.connectionId},provider_payload=${context.tx.json(hosted.payload)},provider_payload_hash=${workflowHash(hosted.payload)},provider_idempotency_key=${`email:${intent.id}`},is_test=${hosted.isTest} where id=${intent.id}`;
  return intent.id as string;
}
