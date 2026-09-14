import { createReceivingWorkerHttp } from "@/lib/email/inbound/worker-http";
import { runEmailWorker } from "@/lib/email/dispatch/run";
import { workflowDatabase } from "@/lib/email/workflow/connection";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;
const run = createReceivingWorkerHttp({
  database: workflowDatabase,
  process: runEmailWorker,
  enabled: () => process.env.EMAIL_RECEIVING_WORKER_ENABLED === "true",
  secret: () => process.env.EMAIL_RECEIVING_WORKER_SECRET,
  cronSecret: () => process.env.CRON_SECRET,
  ownerId: () => process.env.EMAIL_RECEIVING_WORKER_OWNER_ID,
});
export const GET = run;
export const POST = run;
