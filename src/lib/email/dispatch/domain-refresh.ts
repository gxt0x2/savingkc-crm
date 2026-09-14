import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { ownerWorkspace } from "../connections/service";
import { executeDomainCommand } from "../domains/service";
import { resendDomainProvider, type DomainProvider } from "../domains/provider";
import { WorkflowError, type Tx } from "../workflow/core";

/** Refresh one existing active sender domain, never create or unpause a domain. */
export async function refreshActiveSenderDomain(
  sql: Sql,
  subject: string,
  now = new Date(),
  provider: DomainProvider = resendDomainProvider,
) {
  const domain = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject);
    const [row] =
      await tx`select d.id,d.revision from em_domains d join em_workspaces w on w.id=d.workspace_id
      where d.workspace_id=${ws.id} and w.execution_mode='hosted' and w.send_enabled and w.pause_reason is null
      and not d.paused and d.state='provider_verified' and d.provider_domain_id is not null
      and (d.last_verified_at is null or d.last_verified_at<${new Date(now.getTime() - 12 * 3600000)})
      and (d.last_checked_at is null or d.last_checked_at<${new Date(now.getTime() - 30 * 60000)})
      and exists(select 1 from em_senders s where s.domain_id=d.id and s.workspace_id=d.workspace_id and s.state='active')
      order by d.last_verified_at nulls first,d.id limit 1`;
    return row;
  });
  if (!domain) return { state: "idle" };
  try {
    await executeDomainCommand(
      sql,
      subject,
      {
        command: "DOM-VERIFY",
        idempotencyKey: randomUUID(),
        expectedRevision: domain.revision,
        payload: { domainId: domain.id },
      },
      provider,
      undefined,
      now,
    );
    return { state: "checked" };
  } catch (error) {
    // Existing dispatch guards still hold sends if the stored verification expires.
    return {
      state: "review_required",
      code:
        error instanceof WorkflowError ? error.code : "DOMAIN_REFRESH_FAILED",
    };
  }
}
