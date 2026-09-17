import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startDisposableDatabase, fixtureOwner as owner, fixtureReader as reader, fixtureNow } from '../email-local/database.mjs';
import { contactHygieneReasons, selectInitialAddresses } from '../../src/lib/email/hygiene/guards';
import { suppress } from '../../src/lib/email/workflow/service';
import { changeContactRules, readContactRules } from '../../src/lib/email/hygiene/service';
import { reviewedCallback } from '../email-local/callback-fixture';
import type { Tx } from '../../src/lib/email/workflow/core';
const now = new Date(fixtureNow);
type DB = Awaited<ReturnType<typeof startDisposableDatabase>>;
async function alias(db: DB, partyId: string) {
    const email = `${randomUUID()}@example.test`, sql = db.sql;
    const [a] = await sql `insert into em_addresses(workspace_id,raw_address,normalized_address,verification_state,verification_expires_at) values(${db.workspaceId},${email},${email},'valid','2027-01-01') returning id`;
    await sql `insert into em_party_addresses(workspace_id,party_id,address_id,relationship,confirmed_at) values(${db.workspaceId},${partyId},${a.id},'confirmed',${now})`;
    return a.id as string;
}
async function reasons(db: DB, partyId: string, addressId: string, sequence = true) { return db.sql.begin(t => contactHygieneReasons(t as unknown as Tx, { workspaceId: db.workspaceId, partyId, addressId, now, sequence })); }
async function stop(db: DB, addressId: string, reason: string) { await db.sql.begin(t => suppress({ tx: t as unknown as Tx, member: { workspace_id: db.workspaceId, auth_user_id: owner, roles: ['owner'] }, now }, addressId, reason)); }
test('a persons opt-out excludes later aliases but never another heir at the same property', async () => {
    const db = await startDisposableDatabase();
    try {
        const [first, heir] = db.partyIds;
        const [a] = await db.sql `select address_id from em_party_addresses where party_id=${first}`;
        const [b] = await db.sql `select address_id from em_party_addresses where party_id=${heir}`;
        await db.sql `update em_party_properties set canonical_property_id=${db.canonicalProperties[0]},relationship='heir' where party_id=${heir}`;
        await stop(db, a.address_id, 'unsubscribe');
        const late = await alias(db, first);
        assert.ok((await reasons(db, first, late, false)).includes('This person stopped marketing'));
        assert.deepEqual(await reasons(db, heir, b.address_id), []);
        const [held] = await db.sql `select count(*)::int as n from em_property_marketing_holds`;
        assert.equal(held.n, 0);
    }
    finally {
        await db.stop();
    }
});
test('hard bounce is mailbox only; shared mailbox unsubscribe does not spread to private mailboxes', async () => {
    const db = await startDisposableDatabase();
    try {
        const [first, second] = db.partyIds, privateA = await alias(db, first), privateB = await alias(db, second);
        const [original] = await db.sql `select address_id from em_selected_addresses where party_id=${first}`;
        await stop(db, original.address_id, 'hard_bounce');
        assert.deepEqual(await reasons(db, first, privateA, false), []);
        await db.sql `insert into em_party_addresses(workspace_id,party_id,address_id,relationship) values(${db.workspaceId},${second},${original.address_id},'shared')`;
        await stop(db, original.address_id, 'unsubscribe');
        assert.deepEqual(await reasons(db, first, privateA, false), []);
        assert.deepEqual(await reasons(db, second, privateB, false), []);
        assert.ok((await reasons(db, second, original.address_id, false)).includes('This mailbox is stopped'));
    }
    finally {
        await db.stop();
    }
});
test('only two selected addresses are retained and neither bounce nor reimport promotes the backup', async () => {
    const db = await startDisposableDatabase();
    try {
        const first = db.partyIds[0], backup = await alias(db, first), extra = await alias(db, first);
        await db.sql.begin(t => selectInitialAddresses(t as unknown as Tx, db.workspaceId, first));
        const selected = await db.sql `select address_id,slot from em_selected_addresses where party_id=${first} order by slot`;
        assert.equal(selected.length, 2);
        await stop(db, selected[0].address_id, 'hard_bounce');
        await db.sql.begin(t => selectInitialAddresses(t as unknown as Tx, db.workspaceId, first));
        assert.deepEqual(await db.sql `select address_id,slot from em_selected_addresses where party_id=${first} order by slot`, selected);
        const held = await Promise.all([reasons(db, first, backup), reasons(db, first, extra)]);
        assert.equal(held.flat().filter(r => r === 'Backup address — not active').length, 1);
        assert.equal(held.flat().filter(r => r === 'Address is outside the selected pair').length, 1);
        const migration = await readFile(new URL('../../supabase/migrations/20261110120000_email_person_property_hygiene.sql', import.meta.url), 'utf8');
        await db.sql.unsafe(migration);
        await db.sql.unsafe(migration);
        assert.equal((await db.sql `select address_id from em_selected_addresses where party_id=${first}`).length, 2);
    }
    finally {
        await db.stop();
    }
});
test('owner-only property hold is auditable, stale-safe and idempotent; release never clears a person stop', async () => {
    const db = await startDisposableDatabase();
    try {
        const command = await reviewedCallback(db), threadId = command.payload.threadId;
        const state = await readContactRules(db.sql, owner, threadId);
        const input = { threadId, expectedHash: state.hash, idempotencyKey: randomUUID(), action: 'hold_property', propertyId: state.properties[0].id, reason: 'Representative asked to pause property outreach' };
        await assert.rejects(changeContactRules(db.sql, reader, input, now), /FORBIDDEN/);
        const first = await changeContactRules(db.sql, owner, input, now);
        assert.deepEqual(await changeContactRules(db.sql, owner, input, now), first);
        await assert.rejects(changeContactRules(db.sql, owner, { ...input, idempotencyKey: randomUUID() }, now), /CONTACT_RULE_CHANGED/);
        const [address] = state.addresses;
        assert.ok((await reasons(db, state.person.id, address.id)).some(r => r.startsWith('Property outreach held:')));
        await stop(db, address.id, 'unsubscribe');
        const fresh = await readContactRules(db.sql, owner, threadId);
        await changeContactRules(db.sql, owner, { ...input, action: 'release_property', expectedHash: fresh.hash, idempotencyKey: randomUUID() }, now);
        assert.ok((await reasons(db, state.person.id, address.id, false)).includes('This person stopped marketing'));
        const [audit] = await db.sql `select count(*)::int as n from em_audit_events where action='CONTACT-RULE'`;
        assert.equal(audit.n, 2);
    }
    finally {
        await db.stop();
    }
});
