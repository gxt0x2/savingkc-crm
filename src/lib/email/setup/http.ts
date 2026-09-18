import "server-only";
import { z } from "zod";
import {
  sameOrigin,
  workflowErrorResponse,
  type WorkflowHttpDependencies,
} from "../workflow/http";
import { check, type Tx } from "../workflow/core";
import { ownerWorkspace } from "../connections/service";
import { readDomains } from "../domains/service";
import { importExistingDomain } from "./import-domain";
import { queueControlledTest } from "../dispatch/controlled-test";
import { processNextDispatch } from "../dispatch/service";
import { runEmailWorker } from "../dispatch/run";
import { readHostedReadiness, enableTestedSending } from "./readiness";
const input = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("import_domain"),
      domain: z.string().trim().toLowerCase().min(3).max(253),
    })
    .strict(),
  z
    .object({
      action: z.literal("send_test"),
      senderId: z.string().uuid(),
      idempotencyKey: z.string().uuid(),
      campaignId: z.string().uuid().optional(),
      samplePartyId: z.string().uuid().optional(),
    })
    .strict(),
  z.object({ action: z.literal("process_replies") }).strict(),
  z
    .object({
      action: z.literal("enable_sending"),
      expectedRevision: z.number().int().nonnegative(),
    })
    .strict(),
]);
export function createHostedSetupHttp(deps: WorkflowHttpDependencies) {
  return {
    async GET(request: Request) {
      try {
        const subject = await deps.subject(request);
        check(subject, "SIGN_IN_REQUIRED", 401);
        const sql = deps.database();
        const readiness = await sql.begin(async (transaction) => {
          const tx = transaction as unknown as Tx;
          const ws = await ownerWorkspace(tx, subject);
          return readHostedReadiness(tx, ws.id);
        });
        return Response.json(
          {
            readiness,
            domains: await readDomains(sql, subject),
            testRecipient: process.env.EMAIL_CONTROLLED_RECIPIENT ?? null,
          },
          { headers: { "Cache-Control": "private, no-store" } },
        );
      } catch (error) {
        return workflowErrorResponse(error);
      }
    },
    async POST(request: Request) {
      try {
        check(sameOrigin(request), "INVALID_ORIGIN", 403);
        check(
          request.headers.get("content-type")?.startsWith("application/json"),
          "JSON_REQUIRED",
          415,
        );
        const subject = await deps.subject(request);
        check(subject, "SIGN_IN_REQUIRED", 401);
        const text = await request.text();
        check(text.length <= 2048, "COMMAND_TOO_LARGE", 413);
        let raw: unknown;
        try {
          raw = JSON.parse(text);
        } catch {
          check(false, "INVALID_JSON", 400);
        }
        const parsed = input.safeParse(raw);
        check(parsed.success, "INVALID_COMMAND", 400);
        const command = parsed.data,
          sql = deps.database();
        let result: unknown;
        if (command.action === "import_domain")
          result = await importExistingDomain(sql, subject, command.domain);
        else if (command.action === "send_test") {
          const queued = await queueControlledTest(sql, subject, {
            senderId: command.senderId,
            idempotencyKey: command.idempotencyKey,
            campaignId: command.campaignId,
            samplePartyId: command.samplePartyId,
          });
          const [existing] = await sql`select state from em_send_intents where id=${queued.entityId}`;
          result = {
            ...queued,
            delivery: existing?.state === "accepted" ? { state: "accepted", alreadySent: true } : await processNextDispatch(sql, subject, {
              allowlistedTest: process.env.EMAIL_CONTROLLED_RECIPIENT,
              intentId: queued.entityId,
            }),
          };
        } else if (command.action === "process_replies")
          result = await runEmailWorker(sql, subject);
        else
          result = await enableTestedSending(
            sql,
            subject,
            command.expectedRevision,
          );
        return Response.json(result, {
          headers: { "Cache-Control": "private, no-store" },
        });
      } catch (error) {
        return workflowErrorResponse(error);
      }
    },
  };
}
