import 'server-only';
import type { Tx } from '../workflow/core';
/** Called on confirmed identity import. Keeps existing slots; never auto-promotes. */
export async function selectInitialAddresses(tx: Tx, workspaceId: string, partyId: string) {
    await tx `select id from em_parties where workspace_id=${workspaceId} and id=${partyId} for update`;
    const candidates = await tx `select pa.address_id from em_party_addresses pa join em_addresses a on a.id=pa.address_id
    where pa.workspace_id=${workspaceId} and pa.party_id=${partyId} and pa.relationship='confirmed'
    and not exists(select 1 from em_selected_addresses s where s.workspace_id=pa.workspace_id and s.party_id=pa.party_id and s.address_id=pa.address_id)
    order by pa.confirmed_at,pa.id`;
    for (const candidate of candidates) {
        const [slot] = await tx `select n from generate_series(1,2) n where not exists(select 1 from em_selected_addresses s where s.workspace_id=${workspaceId} and s.party_id=${partyId} and s.slot=n) order by n limit 1`;
        if (!slot)
            break;
        await tx `insert into em_selected_addresses(workspace_id,party_id,address_id,slot) values(${workspaceId},${partyId},${candidate.address_id},${slot.n}) on conflict do nothing`;
    }
}
/** Same gate at review and immediately before sending. Scope never follows property to another person. */
export async function contactHygieneReasons(tx: Tx, input: {
    workspaceId: string;
    partyId: string;
    addressId: string;
    now: Date;
    threadId?: string;
    sequence?: boolean;
    recontactDays?: number;
}) {
    const { workspaceId: ws, partyId, addressId, now } = input;
    const reasons: string[] = [];
    const [person] = await tx `select status from em_person_marketing_rules where workspace_id=${ws} and party_id=${partyId}`;
    if (person)
        reasons.push(person.status === 'stopped' ? 'This person stopped marketing' : person.status === 'deceased_confirmed' ? 'Person confirmed deceased' : 'Reported deceased — verify before contact');
    const [stop] = await tx `select id from em_suppressions where workspace_id=${ws} and address_id=${addressId}`;
    if (stop)
        reasons.push('This mailbox is stopped');
    const links = await tx `select party_id,relationship from em_party_addresses where workspace_id=${ws} and address_id=${addressId} and relationship in ('confirmed','shared')`;
    if (links.length !== 1 || links[0].party_id !== partyId || links[0].relationship !== 'confirmed')
        reasons.push('Shared or uncertain mailbox — review identity');
    if (input.sequence !== false) {
        const [selected] = await tx `select slot from em_selected_addresses where workspace_id=${ws} and party_id=${partyId} and address_id=${addressId}`;
        if (selected?.slot !== 1)
            reasons.push(selected?.slot === 2 ? 'Backup address — not active' : 'Address is outside the selected pair');
        const [hold] = await tx `select h.reason from em_party_properties pp join em_property_marketing_holds h on h.workspace_id=pp.workspace_id and h.canonical_property_id=pp.canonical_property_id and h.active where (h.reason<>'conversation_active' or h.source_party_id is distinct from ${partyId}::uuid) and pp.workspace_id=${ws} and pp.party_id=${partyId} limit 1`;
        if (hold)
            reasons.push(`Property outreach held: ${hold.reason}`);
        const [recent] = await tx `select t.id from em_threads t join em_send_intents i on i.thread_id=t.id and i.workspace_id=t.workspace_id
      where t.workspace_id=${ws} and t.party_id=${partyId} and (${input.threadId ?? null}::uuid is null or t.id<>${input.threadId ?? null})
      and i.accepted_at>${new Date(now.getTime() - Math.max(90, input.recontactDays ?? 90) * 86400000)} and not i.is_test limit 1`;
        if (recent)
            reasons.push('Person is in the 90-day recontact cooldown');
        const [other] = await tx `select t.id from em_threads t where t.workspace_id=${ws} and t.party_id=${partyId} and t.id is distinct from ${input.threadId ?? null}::uuid and t.state not in ('done','stopped') limit 1`;
        if (other)
            reasons.push('Person already has an active conversation');
    }
    return reasons;
}
