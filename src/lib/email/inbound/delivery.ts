import { decryptEmailSecret } from '../secrets';
import { connectionMasterKey } from '../connections/service';
import { validMessageId } from './routing';
import "server-only";
import type { Sql } from "postgres";
import { ownerWorkspace } from "../connections/service";
import { suppress } from "../workflow/service";
import type { Tx } from "../workflow/core";

export const deliveryEventTypes = new Set([
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.delivery_delayed",
  "email.failed",
  "email.opened",
  "email.clicked",
  "email.scheduled",
  "email.suppressed",
]);
const rank: Record<string, number> = {
  provider_accepted: 0,
  "email.sent": 1,
  "email.delivery_delayed": 2,
  "email.delivered": 3,
  "email.failed": 4,
  "email.bounced": 5,
  "email.complained": 6,
  "email.suppressed": 7,
};
/** Accept out-of-order events without downgrading delivery or releasing stops. */
export async function reduceDeliveryEvent(
  tx: Tx,
  event: {
    id: string;
    workspace_id: string;
    connection_id: string;
    provider_email_id: string | null;
    type: string;
    messageId?: string;
  },
  now: Date,
) {
  if (!deliveryEventTypes.has(event.type) || !event.provider_email_id)
    return false;
  const [intent] =
    await tx`select i.id,i.remote_outcome,t.address_id,t.id as thread_id,t.campaign_id,t.responsible_user_id from em_send_intents i
    join em_threads t on t.id=i.thread_id and t.workspace_id=i.workspace_id
    where i.workspace_id=${event.workspace_id} and i.connection_id=${event.connection_id} and i.provider_message_id=${event.provider_email_id}`;
  if (!intent) return false;
  let messageId = event.messageId;
  if (!messageId) {
    const key = connectionMasterKey();
    const [stored] = await tx`select encrypted_payload from em_provider_events where id=${event.id} and workspace_id=${event.workspace_id}`;
    if (key && stored?.encrypted_payload) {
      const payload = JSON.parse(decryptEmailSecret(stored.encrypted_payload, key, `${event.workspace_id}/${event.id}/resend-event/1`));
      messageId = payload.data?.message_id;
    }
  }
  if (validMessageId(messageId))
    await tx`update em_send_intents set rfc_message_id=${messageId} where workspace_id=${event.workspace_id} and connection_id=${event.connection_id} and id=${intent.id} and (rfc_message_id is null or rfc_message_id=${messageId})`;

  if ((rank[event.type] ?? 0) > (rank[intent.remote_outcome] ?? 0))
    await tx`update em_send_intents set remote_outcome=${event.type} where id=${intent.id}`;
  if (
    ["email.bounced", "email.complained", "email.suppressed"].includes(
      event.type,
    )
  ) {
    await suppress(
      {
        tx,
        now,
        member: {
          workspace_id: event.workspace_id,
          auth_user_id: null,
          roles: [],
        },
      },
      intent.address_id,
      event.type === "email.bounced"
        ? "bounce"
        : event.type === "email.complained"
          ? "complaint"
          : "provider_suppressed",
    );
  }
  // This pilot is deliberately small: any bounce or complaint warrants review.
  if (["email.bounced", "email.complained", "email.suppressed"].includes(event.type)) {
    const [paused] = await tx`update em_campaigns set state='paused',revision=revision+1 where workspace_id=${event.workspace_id} and id=${intent.campaign_id} and state='active' and not is_test returning id`;
    if (paused) {
      await tx`update em_send_intents set state='cancelled',cancellation_reason='pilot_delivery_review' where workspace_id=${event.workspace_id} and origin='sequence' and state in ('queued','held') and thread_id in(select id from em_threads where campaign_id=${paused.id} and workspace_id=${event.workspace_id})`;
      await tx`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key,created_at) values(${event.workspace_id},${intent.thread_id},${intent.responsible_user_id},'Campaign paused — review bounce or complaint before further outreach',${`campaign-delivery-pause:${paused.id}`},${now}) on conflict do nothing`;
      await tx`insert into em_audit_events(workspace_id,action,entity_id,request_id,detail,created_at) values(${event.workspace_id},'PILOT-DELIVERY-PAUSE',${paused.id},${event.id},${tx.json({ event: event.type, automaticRestart: false })},${now})`;
    }
  }
  if (event.type === "email.failed") {
    await tx`update em_send_intents set state='cancelled',cancellation_reason='provider_delivery_failed' where workspace_id=${event.workspace_id} and thread_id=${intent.thread_id} and state in ('queued','held')`;
    await tx`update em_threads set state=case when state in ('stopped','done') then state else 'needs_review' end where id=${intent.thread_id}`;
  }
  await tx`update em_provider_events set state='processed',hold_reason=null,thread_id=${intent.thread_id} where id=${event.id}`;
  return true;
}
/** Reconcile delivery webhooks that arrived before the send response was saved. */
export async function processPendingDeliveryEvents(
  sql: Sql,
  subject: string,
  now = new Date(),
) {
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject);
    const rows =
      await tx`select id,workspace_id,connection_id,provider_email_id,type from em_provider_events
      where workspace_id=${ws.id} and state='pending' and hold_reason='awaiting_send_receipt' order by created_at,id limit 20`;
    let processed = 0;
    for (const event of rows)
      if (
        await reduceDeliveryEvent(
          tx,
          event as Parameters<typeof reduceDeliveryEvent>[1],
          now,
        )
      )
        processed++;
    return processed;
  });
}
