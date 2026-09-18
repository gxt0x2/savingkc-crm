import 'server-only';
import type { Sql } from 'postgres';
import { z } from 'zod';
import { ownerWorkspace } from '../connections/service';
import { check, workflowHash, json, type Tx } from '../workflow/core';
import { cancelPropertySequences } from './property';
import { suppress } from '../workflow/service';
const schema = z.object({ threadId: z.string().uuid(), expectedHash: z.string().length(64), idempotencyKey: z.string().uuid(),
    action: z.enum(['stop_person', 'deceased_reported', 'deceased_confirmed', 'clear_deceased_hold', 'select_addresses', 'hold_property', 'release_property']),
    reason: z.string().trim().min(5).max(1000), primaryAddressId: z.string().uuid().optional(), backupAddressId: z.string().uuid().optional(), propertyId: z.string().uuid().optional() }).strict();
async function snapshot(tx: Tx, ws: string, threadId: string) {
    const [person] = await tx `select p.id,p.display_name,p.revision,r.status,r.reason,r.evidence,r.updated_at from em_threads t join em_parties p on p.id=t.party_id and p.workspace_id=t.workspace_id left join em_person_marketing_rules r on r.workspace_id=p.workspace_id and r.party_id=p.id where t.workspace_id=${ws} and t.id=${threadId}`;
    check(person, 'THREAD_NOT_FOUND', 404);
    const addresses = await tx `select a.id,a.normalized_address as email,pa.relationship,s.slot,exists(select 1 from em_suppressions x where x.workspace_id=${ws} and x.address_id=a.id) as stopped from em_party_addresses pa join em_addresses a on a.id=pa.address_id left join em_selected_addresses s on s.workspace_id=pa.workspace_id and s.party_id=pa.party_id and s.address_id=pa.address_id where pa.workspace_id=${ws} and pa.party_id=${person.id} order by s.slot nulls last,a.id`;
    const properties = await tx `select distinct pp.canonical_property_id as id,pp.address,h.active,h.reason,h.evidence,h.updated_at,h.owner_id,h.source_party_id from em_party_properties pp left join em_property_marketing_holds h on h.workspace_id=pp.workspace_id and h.canonical_property_id=pp.canonical_property_id where pp.workspace_id=${ws} and pp.party_id=${person.id} and pp.canonical_property_id is not null order by pp.canonical_property_id`;
    const data = { person, addresses, properties };
    return { ...data, hash: workflowHash(json(data)) };
}
export async function readContactRules(sql: Sql, subject: string, threadId: string) {
    check(z.string().uuid().safeParse(threadId).success, 'INVALID_THREAD', 400);
    return sql.begin(async (transaction) => { const tx = transaction as unknown as Tx, ws = await ownerWorkspace(tx, subject); return snapshot(tx, ws.id, threadId); });
}
export async function changeContactRules(sql: Sql, subject: string, raw: unknown, now = new Date()) {
    const parsed = schema.safeParse(raw);
    check(parsed.success, 'INVALID_CONTACT_RULE', 400);
    const input = parsed.data, hash = workflowHash(input);
    return sql.begin(async (transaction) => {
        const tx = transaction as unknown as Tx, ws = await ownerWorkspace(tx, subject);
        const [prior] = await tx `select payload_hash,result from em_command_receipts where workspace_id=${ws.id} and actor_id=${subject} and idempotency_key=${input.idempotencyKey}`;
        if (prior) {
            check(prior.payload_hash === hash, 'IDEMPOTENCY_MISMATCH');
            return prior.result;
        }
        const current = await snapshot(tx, ws.id, input.threadId);
        check(current.hash === input.expectedHash, 'CONTACT_RULE_CHANGED');
        const partyId = current.person.id;
        const context = { tx, member: { workspace_id: ws.id, auth_user_id: subject, roles: ['owner'] }, now };
        if (input.action === 'select_addresses') {
            check(input.primaryAddressId, 'PRIMARY_REQUIRED', 400);
            const selected = [input.primaryAddressId, ...(input.backupAddressId ? [input.backupAddressId] : [])];
            check(new Set(selected).size === selected.length, 'DUPLICATE_ADDRESS', 400);
            const [active] = await tx `select id from em_threads where workspace_id=${ws.id} and party_id=${partyId} and state not in ('done','stopped') limit 1`;
            const [pending] = await tx `select i.id from em_send_intents i join em_threads t on t.id=i.thread_id where t.workspace_id=${ws.id} and t.party_id=${partyId} and i.state in ('queued','held','dispatching','uncertain') limit 1`;
            check(!active && !pending, 'FINISH_ACTIVE_CONVERSATION_FIRST');
            for (const id of selected) {
                const links = await tx `select party_id,relationship from em_party_addresses where workspace_id=${ws.id} and address_id=${id} and relationship in ('confirmed','shared')`;
                check(links.length === 1 && links[0].party_id === partyId && links[0].relationship === 'confirmed', 'CONFIRMED_PERSON_ADDRESS_REQUIRED');
            }
            await tx `delete from em_selected_addresses where workspace_id=${ws.id} and party_id=${partyId}`;
            for (const [index, id] of selected.entries())
                await tx `insert into em_selected_addresses(workspace_id,party_id,address_id,slot) values(${ws.id},${partyId},${id},${index + 1})`;
        }
        else if (input.action === 'hold_property' || input.action === 'release_property') {
            check(current.properties.some(p => p.id === input.propertyId), 'LINKED_PROPERTY_REQUIRED', 400);
            await tx `insert into em_property_marketing_holds(workspace_id,canonical_property_id,reason,evidence,owner_id,source_party_id,active,updated_at)
      values(${ws.id},${input.propertyId!},'owner_review',${input.reason},${subject},${partyId},${input.action === 'hold_property'},${now})
      on conflict(workspace_id,canonical_property_id) do update set reason=excluded.reason,evidence=excluded.evidence,owner_id=excluded.owner_id,source_party_id=excluded.source_party_id,active=excluded.active,updated_at=excluded.updated_at`;
            if (input.action === 'hold_property')
                await cancelPropertySequences(context, input.propertyId!);
        }
        else if (input.action === 'clear_deceased_hold') {
            check(['deceased_reported', 'deceased_confirmed'].includes(current.person.status), 'ONLY_DECEASED_HOLD_CAN_BE_CLEARED');
            await tx `delete from em_person_marketing_rules where workspace_id=${ws.id} and party_id=${partyId} and status in ('deceased_reported','deceased_confirmed')`;
        }
        else {
            await tx `insert into em_person_marketing_rules(workspace_id,party_id,status,reason,evidence,updated_by,updated_at) values(${ws.id},${partyId},${input.action === 'stop_person' ? 'stopped' : input.action},${input.action},${input.reason},${subject},${now})
      on conflict(workspace_id,party_id) do update set status=excluded.status,reason=excluded.reason,evidence=excluded.evidence,updated_by=excluded.updated_by,updated_at=excluded.updated_at where em_person_marketing_rules.status<>'stopped'`;
            if (input.action === 'stop_person') {
                // Existing suppression pipeline also cancels queued messages and CRM callback work.
                for (const address of current.addresses.filter(a => a.relationship === 'confirmed'))
                    await suppress(context, address.id, 'manual');
            }
            await tx `update em_drafts set state='stale' where workspace_id=${ws.id} and thread_id in(select id from em_threads where workspace_id=${ws.id} and party_id=${partyId}) and state='current'`;
            await tx `update em_ai_generations set state='stale' where workspace_id=${ws.id} and thread_id in(select id from em_threads where workspace_id=${ws.id} and party_id=${partyId}) and state in ('queued','running','ready')`;
            await tx `update em_send_intents set state='cancelled',cancellation_reason='person_contact_hold' where workspace_id=${ws.id} and thread_id in(select id from em_threads where workspace_id=${ws.id} and party_id=${partyId}) and state in ('queued','held')`;
        }
        await tx `update em_parties set revision=revision+1 where workspace_id=${ws.id} and id=${partyId}`;
        const result = { state: input.action === 'clear_deceased_hold' ? 'Deceased hold cleared after review. Existing opt-outs and mailbox stops still apply. No messages were restarted.' : input.action === 'release_property' ? 'Property hold released. Cancelled messages stay cancelled.' : input.action === 'select_addresses' ? 'Primary and backup saved. No message was queued.' : input.action === 'hold_property' ? 'Outreach held for everyone linked to this property.' : 'Contact stopped for this person. Other people at the property are unchanged.' };
        await tx `insert into em_command_receipts(workspace_id,actor_id,idempotency_key,command,payload_hash,result) values(${ws.id},${subject},${input.idempotencyKey},'CONTACT-RULE',${hash},${tx.json(result)})`;
        await tx `insert into em_audit_events(workspace_id,actor_id,action,entity_id,request_id,detail,created_at) values(${ws.id},${subject},'CONTACT-RULE',${partyId},${input.idempotencyKey},${tx.json({ action: input.action, reason: input.reason, propertyId: input.propertyId, primaryAddressId: input.primaryAddressId, backupAddressId: input.backupAddressId })},${now})`;
        return result;
    });
}
