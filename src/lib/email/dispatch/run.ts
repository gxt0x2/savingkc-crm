import "server-only";
import { processLeadSmsAlerts } from "../notifications/sms-worker";
import type { Sql } from "postgres";
import { processNextReceivedReply } from "../inbound/worker";
import { processPendingDeliveryEvents } from "../inbound/delivery";
import { refreshActiveSenderDomain } from "./domain-refresh";
import { processNextDispatch } from "./service";
/** Inbound and suppression reconciliation always run before outbound work. */
export async function runEmailWorker(sql: Sql, owner: string) {
  const reconciled = await processPendingDeliveryEvents(sql, owner);
  const receiving = await processNextReceivedReply(sql, owner);
  const leadSms = await processLeadSmsAlerts(sql, owner);
  const domains = await refreshActiveSenderDomain(sql, owner);
  const dispatch =
    process.env.EMAIL_DISPATCH_WORKER_ENABLED === "true"
      ? await processNextDispatch(sql, owner)
      : { state: "disabled", processed: 0 };
  return { state: "processed", reconciled, receiving, domains, dispatch, leadSms };
}
