import "server-only";
import { randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { connectionMasterKey, ownerWorkspace } from "../connections/service";
import { decryptEmailSecret } from "../secrets";
import { resendDomainProvider, type DomainProvider } from "../domains/provider";
import { assertIndependentSendingDomain } from "../providers/resend-domains";
import { check, json, type Tx } from "../workflow/core";

/** Adopts a domain already in this connected account; never purchases or creates one. */
export async function importExistingDomain(
  sql: Sql,
  subject: string,
  name: string,
  provider: DomainProvider = resendDomainProvider,
) {
  const key = connectionMasterKey();
  check(key, "CREDENTIAL_STORAGE_REQUIRED", 503);
  const reserved = await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject);
    const [workspace] =
      await tx`select config from em_workspaces where id=${ws.id}`;
    const primary = workspace.config?.business?.primaryDomain;
    check(primary, "BUSINESS_SETUP_REQUIRED");
    assertIndependentSendingDomain(name, primary);
    const [connection] =
      await tx`select id,encrypted_secret from em_service_connections where workspace_id=${ws.id} and state='checked' order by checked_at desc limit 1`;
    check(connection, "SERVICE_CONNECTION_REQUIRED");
    return {
      workspaceId: ws.id as string,
      revision: ws.revision,
      connectionId: connection.id as string,
      secret: decryptEmailSecret(
        connection.encrypted_secret,
        key,
        `${ws.id}/${connection.id}/resend/1`,
      ),
    };
  });
  let domain;
  try {
    domain = await provider.find(reserved.secret, name);
  } finally {
    reserved.secret = "";
  }
  check(
    domain && domain.name.toLowerCase() === name,
    "PROVIDER_DOMAIN_NOT_FOUND",
    404,
  );
  check(
    domain.status === "verified" &&
      domain.capabilities.sending === "enabled" &&
      domain.capabilities.receiving === "enabled",
    "DOMAIN_VERIFICATION_REQUIRED",
  );
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx,
      ws = await ownerWorkspace(tx, subject);
    check(
      ws.id === reserved.workspaceId && ws.revision === reserved.revision,
      "SETUP_CHANGED",
    );
    const [connection] =
      await tx`select state from em_service_connections where workspace_id=${ws.id} and id=${reserved.connectionId}`;
    check(connection?.state === "checked", "SERVICE_CONNECTION_REQUIRED");
    const [existing] =
      await tx`select id,connection_id from em_domains where workspace_id=${ws.id} and name_ascii=${name}`;
    check(
      !existing || existing.connection_id === reserved.connectionId,
      "DOMAIN_CONNECTION_CONFLICT",
    );
    const [saved] =
      await tx`insert into em_domains(workspace_id,connection_id,name_ascii,provider_domain_id,brand_url,state,sending_state,receiving_state,dns_records,paused,created_by,last_verified_at,last_checked_at)
    values(${ws.id},${reserved.connectionId},${name},${domain.id},${`https://${name}`},'provider_verified','enabled','enabled',${tx.json(json(domain.records))},true,${subject},now(),now())
    on conflict(workspace_id,name_ascii) do update set provider_domain_id=excluded.provider_domain_id,state='provider_verified',sending_state='enabled',receiving_state='enabled',dns_records=excluded.dns_records,last_verified_at=now(),last_checked_at=now(),revision=em_domains.revision+1 returning id`;
    await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail) values(${ws.id},${subject},'DOM-IMPORT',${saved.id},${randomUUID()},${tx.json({ domain: name, providerDomainId: domain.id })})`;
    return { domainId: saved.id as string, state: "verified_for_test" };
  });
}
