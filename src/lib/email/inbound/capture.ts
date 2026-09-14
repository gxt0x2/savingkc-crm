import "server-only";
import { deliveryEventTypes, reduceDeliveryEvent } from "./delivery";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { Sql } from "postgres";
import { decryptEmailSecret, encryptEmailSecret } from "../secrets";
import { connectionMasterKey } from "../connections/service";
import { check, json, type Tx } from "../workflow/core";
import { workflowErrorResponse } from "../workflow/http";
import { readWebhookBody, verifyResendWebhook } from "./verify";

const envelope = z
  .object({
    type: z.string().min(1).max(100),
    created_at: z.string().datetime(),
    data: z.object({ email_id: z.string().uuid().optional() }).passthrough(),
  })
  .passthrough();
const received = z.object({
  email_id: z.string().uuid(),
  from: z.string().email(),
  to: z.array(z.string().email()).max(100),
  received_for: z.array(z.string().email()).max(100).optional(),
});
export function webhookSecretAad(workspace: string, endpoint: string) {
  return `${workspace}/${endpoint}/resend-webhook/1`;
}
export function createResendWebhookHttp(deps: {
  database: () => Sql;
  endpointId: () => string | undefined;
  key?: () => Buffer | null;
}) {
  return async function POST(request: Request) {
    try {
      const endpointId = deps.endpointId(),
        key = (deps.key ?? connectionMasterKey)();
      check(
        endpointId && z.string().uuid().safeParse(endpointId).success && key,
        "WEBHOOK_NOT_CONFIGURED",
        503,
      );
      const sql = deps.database();
      const [binding] =
        await sql`select e.*,c.state as connection_state from em_webhook_endpoints e join em_service_connections c on c.workspace_id=e.workspace_id and c.id=e.connection_id where e.id=${endpointId}`;
      check(
        binding?.active && binding.connection_state === "checked",
        "WEBHOOK_NOT_CONFIGURED",
        503,
      );
      const secret = decryptEmailSecret(
        binding.encrypted_secret,
        key,
        webhookSecretAad(binding.workspace_id, binding.id),
      );
      const raw = await readWebhookBody(request);
      const verified = verifyResendWebhook(raw, request.headers, secret);
      const hash = createHash("sha256").update(raw).digest("hex");
      const parsed = envelope.safeParse(verified.payload);
      await sql.begin(async (transaction) => {
        const tx = transaction as unknown as Tx;
        // Share the workspace lock with commands, dispatch and disconnect.
        await tx`select id from em_workspaces where id=${binding.workspace_id} for update`;
        const [fresh] =
          await tx`select e.revision,e.active,c.state from em_webhook_endpoints e join em_service_connections c on c.workspace_id=e.workspace_id and c.id=e.connection_id where e.id=${endpointId} for update of e,c`;
        check(
          fresh?.active &&
            fresh.state === "checked" &&
            fresh.revision === binding.revision,
          "WEBHOOK_CONFIGURATION_CHANGED",
          503,
        );
        const [duplicate] =
          await tx`select payload_hash from em_provider_events where connection_id=${binding.connection_id} and provider_event_id=${verified.id}`;
        if (duplicate) {
          check(
            duplicate.payload_hash === hash,
            "WEBHOOK_REPLAY_CONFLICT",
            409,
          );
          return;
        }
        const eventId = randomUUID();
        if (
          parsed.success &&
          deliveryEventTypes.has(parsed.data.type) &&
          parsed.data.data.email_id
        ) {
          const event = {
            id: eventId,
            workspace_id: binding.workspace_id as string,
            connection_id: binding.connection_id as string,
            provider_email_id: parsed.data.data.email_id,
            type: parsed.data.type,
          };
          await tx`insert into em_provider_events(id,workspace_id,connection_id,provider_event_id,type,payload_hash,state,encrypted_payload,endpoint_id,provider_email_id,provider_created_at,hold_reason)
            values(${eventId},${binding.workspace_id},${binding.connection_id},${verified.id},${event.type},${hash},'pending',${tx.json(json(encryptEmailSecret(raw, key, `${binding.workspace_id}/${eventId}/resend-event/1`, 1)))},${endpointId},${event.provider_email_id},${new Date(parsed.data.created_at)},'awaiting_send_receipt')`;
          await reduceDeliveryEvent(tx, event, new Date());
          return;
        }
        const isReceived =
          parsed.success && parsed.data.type === "email.received";
        const incoming = isReceived
          ? received.safeParse(parsed.data.data)
          : null;
        const addresses = incoming?.success
          ? Array.from(
              new Set(
                (incoming.data.received_for?.length
                  ? incoming.data.received_for
                  : incoming.data.to
                ).map((a) => a.toLowerCase()),
              ),
            )
          : [];
        const matches = addresses.length
          ? await tx`select distinct a.thread_id from em_reply_aliases a join em_threads t on t.id=a.thread_id and t.workspace_id=a.workspace_id where a.workspace_id=${binding.workspace_id} and a.connection_id=${binding.connection_id} and a.address=any(${tx.array(addresses)})`
          : [];
        const matched =
          incoming?.success && matches.length === 1
            ? matches[0].thread_id
            : null;
        const holdReason = !parsed.success
          ? "unsupported_payload"
          : isReceived
            ? matched
              ? "awaiting_reply_content"
              : "unmatched_reply"
            : "event_reducer_pending";
        await tx`insert into em_provider_events(id,workspace_id,connection_id,provider_event_id,type,payload_hash,state,encrypted_payload,endpoint_id,provider_email_id,provider_created_at,hold_reason,thread_id)
          values(${eventId},${binding.workspace_id},${binding.connection_id},${verified.id},${parsed.success ? parsed.data.type : "unknown"},${hash},${matched ? "pending" : "quarantined"},${tx.json(json(encryptEmailSecret(raw, key, `${binding.workspace_id}/${eventId}/resend-event/1`, 1)))},${endpointId},${parsed.success ? (parsed.data.data.email_id ?? null) : null},${parsed.success ? new Date(parsed.data.created_at) : null},${holdReason},${matched})`;
        // Unknown routing or an unsupported event holds the workspace. Never guess by From alone.
        if (!matched)
          await tx`update em_workspaces set pause_reason=coalesce(pause_reason,'Resend event needs review'),revision=revision+1 where id=${binding.workspace_id}`;
        await tx`update em_send_intents set state='cancelled',cancellation_reason=${holdReason} where workspace_id=${binding.workspace_id} and (${!matched} or thread_id=${matched}) and state in ('queued','held')`;
        await tx`update em_drafts set state='stale' where workspace_id=${binding.workspace_id} and (${!matched} or thread_id=${matched}) and state='current'`;
        await tx`update em_ai_generations set state='stale' where workspace_id=${binding.workspace_id} and (${!matched} or thread_id=${matched}) and state in ('queued','running','ready')`;
        if (matched) {
          await tx`update em_threads set inbound_pending=true,content_revision=content_revision+1,state=case when state in ('stopped','done') then state else 'needs_review' end where workspace_id=${binding.workspace_id} and id=${matched}`;
          await tx`update em_enrollments set state=case when state in ('suppressed','completed','failed') then state else 'held' end where workspace_id=${binding.workspace_id} and id=(select enrollment_id from em_threads where id=${matched})`;
        }
        await tx`insert into em_jobs(workspace_id,kind,dedupe_key,entity_id,state) values(${binding.workspace_id},${matched ? "resend_receive_content" : "resend_event_review"},${`resend:${binding.connection_id}:${verified.id}`},${eventId},${matched ? "ready" : "dead"})`;
      });
      return Response.json(
        { ok: true },
        { headers: { "Cache-Control": "no-store" } },
      );
    } catch (error) {
      return workflowErrorResponse(error);
    }
  };
}
