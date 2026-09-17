import 'server-only';
import type { SuppressionContext } from '../workflow/core';
/** Mailbox failures never imply that another address or heir asked to stop. */
export async function suppressionTargets(context: SuppressionContext, addressId: string, reason: string) {
    const { tx, member, now } = context, ws = member.workspace_id;
    if (!['unsubscribe', 'complaint', 'manual'].includes(reason))
        return [{ id: addressId }];
    const links = await tx `select party_id,relationship from em_party_addresses where workspace_id=${ws} and address_id=${addressId} and relationship in ('confirmed','shared')`;
    if (links.length !== 1 || links[0].relationship !== 'confirmed')
        return [{ id: addressId }];
    const partyId = links[0].party_id;
    await tx `insert into em_person_marketing_rules(workspace_id,party_id,status,reason,evidence,updated_by,updated_at)
    values(${ws},${partyId},'stopped',${reason},'Stop from an unambiguous confirmed mailbox',${member.auth_user_id},${now})
    on conflict(workspace_id,party_id) do update set status='stopped',reason=excluded.reason,evidence=excluded.evidence,updated_by=excluded.updated_by,updated_at=excluded.updated_at`;
    // Include this mailbox plus only exclusively owned aliases. Shared inboxes do not propagate identity.
    return tx `select distinct a.id from em_addresses a join em_party_addresses pa on pa.address_id=a.id and pa.workspace_id=a.workspace_id
    where a.workspace_id=${ws} and pa.party_id=${partyId} and pa.relationship='confirmed'
    and (a.id=${addressId} or (select count(*) from em_party_addresses x where x.workspace_id=${ws} and x.address_id=a.id and x.relationship in ('confirmed','shared'))=1)`;
}
