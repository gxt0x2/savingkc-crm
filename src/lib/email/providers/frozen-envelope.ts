import "server-only";
import { outreachFooter, outreachHtml } from "./outreach-footer";
import { createHmac, randomBytes } from "node:crypto";
import { preferenceKeys } from "../preferences/service";
import { check, type Context } from "../workflow/core";
import { emailWorkspaceConfigSchema } from "../config";
import type { FrozenResendPayload } from "./resend";
import { latestReplyMessageId } from '../inbound/routing';

/** Called under the shared workspace lock, alongside intent creation. */
export async function freezeHostedEnvelope(
  context: Context,
  threadId: string,
  body: string,
  subject: string,
): Promise<{
  payload: FrozenResendPayload;
  connectionId: string;
  isTest: boolean;
}> {
  const { tx, member, now } = context;
  const [thread] =
    await tx`select t.*,c.is_test,v.config as campaign_config,a.normalized_address
    from em_threads t join em_campaigns c on c.id=t.campaign_id and c.workspace_id=t.workspace_id
    join em_enrollments e on e.id=t.enrollment_id and e.workspace_id=t.workspace_id
    join em_campaign_versions v on v.id=e.campaign_version_id and v.workspace_id=t.workspace_id
    join em_addresses a on a.id=t.address_id and a.workspace_id=t.workspace_id
    where t.workspace_id=${member.workspace_id} and t.id=${threadId}`;
  check(thread, "THREAD_NOT_FOUND", 404);
  const [workspace] =
    await tx`select config from em_workspaces where id=${member.workspace_id}`;
  const config = emailWorkspaceConfigSchema.parse(workspace.config);
  check(
    config.business?.address && config.business.name,
    "BUSINESS_SETUP_REQUIRED",
  );
  const senderIds: string[] = thread.sender_id
    ? [thread.sender_id]
    : thread.campaign_config.senderIds;
  check(senderIds?.length, "SENDER_REQUIRED");
  const [sender] =
    await tx`select s.*,d.name_ascii,d.connection_id,d.last_verified_at
    from em_senders s join em_domains d on d.id=s.domain_id and d.workspace_id=s.workspace_id
    join em_service_connections c on c.id=d.connection_id and c.workspace_id=d.workspace_id
    where s.workspace_id=${member.workspace_id} and s.id=any(${tx.array(senderIds)}::uuid[])
    and (s.state='active' or (${Boolean(thread.is_test)} and s.state='paused')) and (not d.paused or ${Boolean(thread.is_test)}) and d.state='provider_verified'
    and d.sending_state='enabled' and d.receiving_state='enabled' and c.state='checked'
    order by s.id limit 1`;
  check(
    sender &&
      sender.last_verified_at &&
      new Date(sender.last_verified_at).getTime() > now.getTime() - 86_400_000,
    "SENDER_VERIFICATION_REQUIRED",
  );
  if (!thread.sender_id)
    await tx`update em_threads set sender_id=${sender.id} where workspace_id=${member.workspace_id} and id=${threadId}`;
  const alias = `reply+${threadId.replaceAll("-", "")}@${sender.name_ascii}`;
  await tx`insert into em_reply_aliases(workspace_id,connection_id,thread_id,address)
    values(${member.workspace_id},${sender.connection_id},${threadId},${alias}) on conflict do nothing`;
  const keys = preferenceKeys(),
    version = Object.keys(keys)
      .map(Number)
      .sort((a, b) => b - a)[0];
  check(version, "PREFERENCE_KEY_REQUIRED", 503);
  const token = `${version}.${randomBytes(32).toString("base64url")}`;
  const hash = createHmac("sha256", Buffer.from(keys[String(version)], "hex"))
    .update(token)
    .digest("hex");
  await tx`insert into em_preference_tokens(workspace_id,address_id,key_version,token_hash,issued_by,created_at)
    values(${member.workspace_id},${thread.address_id},${version},${hash},${member.auth_user_id},${now})`;
  const origin = process.env.EMAIL_PUBLIC_ORIGIN;
  check(
    origin && /^https:\/\/[^/?#]+$/.test(origin),
    "EMAIL_PUBLIC_ORIGIN_REQUIRED",
    503,
  );
  const link = `${origin}/email/unsubscribe/${token}`;
  const parent = await latestReplyMessageId(tx, member.workspace_id, threadId);
  return {
    connectionId: sender.connection_id,
    isTest: Boolean(thread.is_test),
    payload: {
      from: `${String(sender.from_name).replace(/[<>\r\n]/g, "")} <${sender.local_part}@${sender.name_ascii}>`,
      to: [thread.normalized_address],
      subject,
      text: `${body}\n\n${outreachFooter(config.business.name, config.business.address, link)}`,
      html: outreachHtml(body, config.business.name, config.business.address, link),
      reply_to: `${sender.local_part}@${sender.name_ascii}`,
      headers: {
        ...(parent ? { "In-Reply-To": parent, "References": parent } : {}),
        "List-Unsubscribe": `<${origin}/api/email/unsubscribe/${token}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    },
  };
}
