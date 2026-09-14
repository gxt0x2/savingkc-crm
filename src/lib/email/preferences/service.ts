import "server-only";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Sql } from "postgres";
import { ownerWorkspace } from "../connections/service";
import { check, type Tx } from "../workflow/core";
import { suppress } from "../workflow/service";

export const preferenceTokenPattern = /^[1-9][0-9]{0,3}\.[A-Za-z0-9_-]{43}$/;
export type PreferenceKeys = Record<string, string>;
export function preferenceKeys(): PreferenceKeys {
  const keys: PreferenceKeys = {};
  for (const [name, value] of Object.entries(process.env)) {
    const match = /^EMAIL_PREFERENCE_KEY_V([1-9][0-9]{0,3})$/.exec(name);
    if (match && value && /^[a-f0-9]{64}$/i.test(value)) keys[match[1]] = value;
  }
  return keys;
}
function digest(token: string, key: string) {
  return createHmac("sha256", Buffer.from(key, "hex"))
    .update(token)
    .digest("hex");
}
/** Server-only issuance; raw tokens belong in outgoing messages, never logs. */
export async function issuePreferenceToken(
  sql: Sql,
  subject: string,
  addressId: string,
  keys = preferenceKeys(),
  now = new Date(),
) {
  const version = Object.keys(keys)
    .map(Number)
    .sort((a, b) => b - a)[0];
  check(
    version && /^[a-f0-9]{64}$/i.test(keys[String(version)]),
    "PREFERENCE_KEY_REQUIRED",
    503,
  );
  const token = `${version}.${randomBytes(32).toString("base64url")}`;
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx;
    const ws = await ownerWorkspace(tx, subject);
    const [address] =
      await tx`select id from em_addresses where workspace_id=${ws.id} and id=${addressId}`;
    check(address, "ADDRESS_NOT_FOUND", 404);
    await tx`insert into em_preference_tokens(workspace_id,address_id,key_version,token_hash,issued_by,created_at)
      values(${ws.id},${addressId},${version},${digest(token, keys[String(version)])},${subject},${now})`;
    return token;
  });
}
/** Valid links work even if campaigns pause or their original issuer leaves. */
export async function unsubscribeWithToken(
  sql: Sql,
  token: string,
  keys = preferenceKeys(),
  now = new Date(),
) {
  if (!preferenceTokenPattern.test(token)) return false;
  const key = keys[token.split(".")[0]];
  // Missing old key is an operational failure, never a false success.
  check(key && /^[a-f0-9]{64}$/i.test(key), "PREFERENCE_KEY_REQUIRED", 503);
  return sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx;
    const [binding] =
      await tx`select * from em_preference_tokens where token_hash=${digest(token, key)}`;
    if (!binding) return false;
    await tx`select id from em_workspaces where id=${binding.workspace_id} for update`;
    // Serialize against sending and human commands using their workspace lock.
    const [existing] =
      await tx`select id from em_suppressions where workspace_id=${binding.workspace_id} and address_id=${binding.address_id}`;
    if (!existing) {
      await suppress(
        {
          tx,
          now,
          member: {
            workspace_id: binding.workspace_id,
            auth_user_id: null,
            roles: [],
          },
        },
        binding.address_id,
        "unsubscribe",
      );
      await tx`insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at)
        values(${binding.workspace_id},null,'PUBLIC-UNSUBSCRIBE',${binding.address_id},${randomUUID()},${tx.json({ actor_type: "public_token", token_id: binding.id })},${now})`;
    }
    await tx`update em_preference_tokens set first_used_at=coalesce(first_used_at,${now}) where id=${binding.id}`;
    return true;
  });
}
