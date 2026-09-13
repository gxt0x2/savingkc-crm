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
  },
  now: Date,
) {
  if (!deliveryEventTypes.has(event.type) || !event.provider_email_id)
    return false;
  const [intent] =
    await tx`select i.id,i.remote_outcome,t.address_id,t.id as thread_id from em_send_intents i
    join em_threads t on t.id=i.thread_id and t.workspace_id=i.workspace_id
    where i.workspace_id=${event.workspace_id} and i.connection_id=${event.connection_id} and i.provider_message_id=${event.provider_email_id}`;
  if (!intent) return false;
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
