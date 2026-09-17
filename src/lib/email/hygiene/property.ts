import 'server-only';
import { authoredReplyText } from '../reply-text';
import type { Context } from '../workflow/core';
/** Coordinate linked people after a real reply. An opt-out alone never creates this hold. */
export async function holdRelatedOutreach(context: Context, threadId: string, evidence: string, reviewAll = false) {
    const { tx, member, now } = context, ws = member.workspace_id;
    const [thread] = await tx `select t.party_id,t.responsible_user_id,c.is_test from em_threads t join em_campaigns c on c.id=t.campaign_id and c.workspace_id=t.workspace_id where t.workspace_id=${ws} and t.id=${threadId}`;
    if (!thread || thread.is_test)
        return;
    const properties = await tx `select distinct canonical_property_id from em_party_properties where workspace_id=${ws} and party_id=${thread.party_id} and canonical_property_id is not null`;
    // Several possible properties require a human to select the relevant property.
    if (properties.length !== 1)
        return;
    await tx `insert into em_property_marketing_holds(workspace_id,canonical_property_id,reason,evidence,owner_id,source_party_id,updated_at)
    values(${ws},${properties[0].canonical_property_id},${reviewAll ? 'owner_review' : 'conversation_active'},${evidence},${thread.responsible_user_id},${thread.party_id},${now}) on conflict(workspace_id,canonical_property_id) do update set reason=excluded.reason,evidence=excluded.evidence,owner_id=excluded.owner_id,source_party_id=excluded.source_party_id,active=true,updated_at=excluded.updated_at where not em_property_marketing_holds.active or (${reviewAll} and em_property_marketing_holds.reason='conversation_active')`;
    await cancelPropertySequences(context, properties[0].canonical_property_id, reviewAll ? undefined : thread.party_id);
}
/** Queued marketing never silently resumes when a property hold is released. */
export async function cancelPropertySequences(context: Context, propertyId: string, exceptPartyId?: string) {
    const { tx, member } = context, ws = member.workspace_id;
    await tx `update em_send_intents set state='cancelled',cancellation_reason='property_outreach_held' where workspace_id=${ws} and origin='sequence' and state in ('queued','held') and thread_id in(
   select t.id from em_threads t join em_party_properties pp on pp.workspace_id=t.workspace_id and pp.party_id=t.party_id where t.workspace_id=${ws} and pp.canonical_property_id=${propertyId} and t.party_id is distinct from ${exceptPartyId ?? null}::uuid)`;
}
/** Broad requests and reported ownership changes require property review, not a permanent family opt-out. */
export function needsPropertyReview(body: string) {
    const text = authoredReplyText(body);
    return /\b(deceased|passed away|died|sold (?:the|this|my|our) (?:house|property))\b/i.test(text)
        || /\b(?:stop|do not|don't)\s+(?:emailing|contacting|contact|email)\s+(?:anyone|everyone|my family|our family|us)\b/i.test(text);
}
