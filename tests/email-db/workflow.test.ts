import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  startDisposableDatabase,
  fixtureOwner as owner,
  fixtureAgent as agent,
  fixtureReader as reader,
  fixtureNow,
} from '../email-local/database.mjs'
import {
  executePilotCommand,
  getPilotReview,
  readPilotState,
  simulateDelivery,
  simulateInbound,
} from '../../src/lib/email/workflow/service'
import { emailCommandResultSchema } from '../../src/lib/email/contracts'
import { createWorkflowHttp } from '../../src/lib/email/workflow/http'
import { pilotFollowUp } from '../../src/lib/email/workflow/schedule'
import type { PilotConfig } from '../../src/lib/email/workflow/types'
const now = new Date(fixtureNow)
type Database = Awaited<ReturnType<typeof startDisposableDatabase>>
const withDb = (name: string, run: (db: Database) => Promise<void>) =>
  test(name, async () => {
    const db = await startDisposableDatabase()
    try {
      await run(db)
    } finally {
      await db.stop()
    }
  })
function config(audienceId: string): PilotConfig {
  return {
    audienceId,
    senderIds: [randomUUID()],
    playbookVersionId: randomUUID(),
    mode: 'draft_only',
    copyMode: 'template',
    draftGenerationBudget: 0,
    steps: [
      {
        id: randomUUID(),
        delayMinCalendarDays: 0,
        delayMaxCalendarDays: 0,
        targetCalendarDay: 0,
        subject: 'Property question',
        bodyTemplate: 'Would selling be worth considering?',
      },
      {
        id: randomUUID(),
        delayMinCalendarDays: 7,
        delayMaxCalendarDays: 10,
        targetCalendarDay: 8,
        subject: 'Re: Property question',
        bodyTemplate: 'Would you prefer I leave it here?',
      },
    ],
    timezone: 'America/Chicago',
    weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    startLocal: '09:00',
    endLocal: '17:00',
    dailyLimit: 10,
    hourlyLimit: 2,
    maxRecipients: 10,
    dailyCostCap: 0,
    totalCostCap: 0,
    recontactDays: 90,
    expiresAt: '2026-12-01T00:00:00Z',
    replyActions: [],
    requiredPermissionBasis: 'Fabricated local fixtures',
  }
}
async function draft(db: Database, name = 'Pilot') {
  const created = await executePilotCommand(
    db.sql,
    owner,
    {
      command: 'CAM-CREATE',
      idempotencyKey: randomUUID(),
      payload: { name, program: 'seller_outreach' },
    },
    now,
  )
  await executePilotCommand(
    db.sql,
    owner,
    {
      command: 'CAM-SAVE',
      entityId: created.entityId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      payload: { draftConfig: config(db.audienceId) },
    },
    now,
  )
  return created.entityId
}
async function launchCommand(db: Database, id: string) {
  const review = await getPilotReview(db.sql, owner, id, now)
  return {
    command: 'CAM-LAUNCH',
    entityId: id,
    expectedRevision: review.revision,
    idempotencyKey: randomUUID(),
    payload: {
      draftHash: review.draftHash,
      audienceHash: review.audienceHash,
      estimateHash: review.estimateHash,
      readinessRunId: review.readinessRunId,
      approvedMaxRecipients: review.recipients.filter((r) => r.eligible).length,
    },
  }
}
async function launched(db: Database) {
  const id = await draft(db)
  await executePilotCommand(db.sql, owner, await launchCommand(db, id), now)
  await simulateDelivery(db.sql, owner, randomUUID(), now)
  const state = await readPilotState(db.sql, owner, now)
  const message = state.messages[0]
  return {
    id,
    thread: state.threads.find((t) => t.id === message.thread_id)!,
    message,
  }
}
const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof Error && e.message === code,
  )

withDb(
  'review excludes unverified recipient; simultaneous replay publishes exactly once with immutable records',
  async (db) => {
    const id = await draft(db),
      review = await getPilotReview(db.sql, owner, id, now)
    assert.equal(review.recipients.filter((r) => r.eligible).length, 2)
    assert.match(
      review.recipients.find((r) => !r.eligible)!.reasons.join(','),
      /verification/,
    )
    const command = await launchCommand(db, id)
    const [a, b] = await Promise.all([
      executePilotCommand(db.sql, owner, command, now),
      executePilotCommand(db.sql, owner, command, now),
    ])
    assert.deepEqual(a, b)
    assert.equal((await db.sql`select * from em_campaign_versions`).length, 1)
    assert.equal((await db.sql`select * from em_enrollments`).length, 2)
    assert.equal((await db.sql`select * from em_send_intents`).length, 2)
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          ...command,
          payload: { ...command.payload, approvedMaxRecipients: 1 },
        },
        now,
      ),
      'IDEMPOTENCY_MISMATCH',
    )
    await assert.rejects(
      db.sql`update em_campaign_versions set config='{}'`,
      /EMAIL_IMMUTABLE_RECORD/,
    )
    await assert.rejects(
      db.sql`update em_snapshot_rows set eligibility='eligible'`,
      /EMAIL_IMMUTABLE_RECORD/,
    )
  },
)
withDb(
  'two reviewed campaigns race for the same people and only one enrolls them',
  async (db) => {
    const first = await draft(db, 'One'),
      second = await draft(db, 'Two')
    const a = await launchCommand(db, first),
      b = await launchCommand(db, second)
    const results = await Promise.allSettled([
      executePilotCommand(db.sql, owner, a, now),
      executePilotCommand(db.sql, owner, b, now),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal((await db.sql`select * from em_enrollments`).length, 2)
    assert.equal((await db.sql`select * from em_campaign_versions`).length, 1)
  },
)
withDb(
  'audit failure rolls back business writes and command receipt',
  async (db) => {
    await db.sql
      .unsafe(`create function fixture_fail_audit() returns trigger language plpgsql as $$ begin raise exception 'fixture audit outage'; end $$;
    create trigger fixture_fail before insert on em_audit_events for each row execute function fixture_fail_audit()`)
    await assert.rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'CAM-CREATE',
          idempotencyKey: randomUUID(),
          payload: { name: 'Rollback', program: 'seller_outreach' },
        },
        now,
      ),
      /fixture audit outage/,
    )
    assert.equal((await db.sql`select * from em_campaigns`).length, 0)
    assert.equal((await db.sql`select * from em_command_receipts`).length, 0)
  },
)
withDb(
  'incoming reply is deduplicated and cancels follow-up before stale draft can send',
  async (db) => {
    const { thread } = await launched(db)
    assert.equal(
      (
        await db.sql`select * from em_send_intents where thread_id=${thread.id} and step=1 and state='queued'`
      ).length,
      1,
    )
    const inbound = {
      threadId: thread.id,
      eventId: randomUUID(),
      body: 'Please call me at 816-555-0101 tomorrow afternoon.',
    }
    await Promise.all([
      simulateInbound(db.sql, owner, inbound, now),
      simulateInbound(db.sql, owner, inbound, now),
    ])
    assert.equal(
      (await db.sql`select * from em_messages where direction='inbound'`)
        .length,
      1,
    )
    assert.equal((await db.sql`select * from em_notifications`).length, 1)
    assert.equal(
      (
        await db.sql`select * from em_send_intents where thread_id=${thread.id} and state='queued'`
      ).length,
      0,
    )
    let current = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === thread.id,
    )!
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-TAKEOVER',
        idempotencyKey: randomUUID(),
        payload: {
          threadId: thread.id,
          expectedControllerRevision: current.controller_revision,
        },
      },
      now,
    )
    current = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === thread.id,
    )!
    const saved = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-DRAFT',
        idempotencyKey: randomUUID(),
        payload: {
          threadId: thread.id,
          body: 'What time works?',
          contentRevision: current.content_revision,
          controllerRevision: current.controller_revision,
        },
      },
      now,
    )
    await simulateInbound(
      db.sql,
      owner,
      {
        ...inbound,
        eventId: randomUUID(),
        body: 'Actually, please wait until next week.',
      },
      now,
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'THR-SEND',
          idempotencyKey: randomUUID(),
          payload: {
            draftId: saved.entityId,
            bodyHash: saved.bodyHash,
            contentRevision: current.content_revision,
            controllerRevision: current.controller_revision,
          },
        },
        now,
      ),
      'DRAFT_CHANGED',
    )
  },
)
withDb(
  'human takeover and delivery serialize; takeover stops future sequence work',
  async (db) => {
    const id = await draft(db)
    await executePilotCommand(db.sql, owner, await launchCommand(db, id), now)
    const thread = (await readPilotState(db.sql, owner, now)).threads[0]
    await Promise.all([
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'THR-TAKEOVER',
          idempotencyKey: randomUUID(),
          payload: { threadId: thread.id, expectedControllerRevision: 0 },
        },
        now,
      ),
      simulateDelivery(db.sql, owner, randomUUID(), now),
    ])
    assert.equal(
      (
        await db.sql`select * from em_send_intents where thread_id=${thread.id} and state='queued'`
      ).length,
      0,
    )
    const current = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === thread.id,
    )!
    assert.equal(current.controller, 'human')
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'THR-TAKEOVER',
          idempotencyKey: randomUUID(),
          payload: { threadId: thread.id, expectedControllerRevision: 0 },
        },
        now,
      ),
      'OWNERSHIP_CHANGED',
    )
  },
)
withDb(
  'handoff stores message evidence and private notification but no Lead or appointment',
  async (db) => {
    const { thread } = await launched(db)
    const body =
      'I would consider selling. Call me at 816-555-0101 tomorrow afternoon.'
    const inbound = await simulateInbound(
      db.sql,
      owner,
      { threadId: thread.id, eventId: randomUUID(), body },
      now,
    )
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-TAKEOVER',
        idempotencyKey: randomUUID(),
        payload: { threadId: thread.id, expectedControllerRevision: 0 },
      },
      now,
    )
    const command = {
      command: 'THR-HANDOFF',
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      payload: {
        threadId: thread.id,
        ownerId: agent,
        backupId: owner,
        reason: 'Seller requested a call',
        requestedContact: {
          phone: '816-555-0101',
          requestedTimeText: 'tomorrow afternoon',
        },
        factEvidence: [
          { source: 'message', messageId: inbound.entityId, quote: body },
        ],
      },
    }
    await executePilotCommand(db.sql, owner, command, now)
    const state = await readPilotState(db.sql, agent, now)
    assert.equal(state.threads.length, 1)
    assert.equal(state.threads[0].controller_user_id, agent)
    assert.equal(state.notifications.length, 1)
    assert.equal(
      (await readPilotState(db.sql, reader, now)).notifications.length,
      0,
    )
    assert.equal((await db.sql`select * from leads`).length, 0)
    assert.equal(
      (await db.sql`select crm_sync_state from em_handoffs`)[0].crm_sync_state,
      'not_connected',
    )
    const notice = state.notifications[0]
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'NTF-ACK',
          idempotencyKey: randomUUID(),
          payload: { eventId: notice.id, eventRevision: 0 },
        },
        now,
      ),
      'NOTIFICATION_NOT_FOUND',
    )
    await executePilotCommand(
      db.sql,
      agent,
      {
        command: 'NTF-ACK',
        idempotencyKey: randomUUID(),
        payload: { eventId: notice.id, eventRevision: 0 },
      },
      now,
    )
    assert.ok(
      (await readPilotState(db.sql, agent, now)).notifications[0]
        .acknowledged_at,
    )
    await simulateInbound(
      db.sql,
      owner,
      {
        threadId: thread.id,
        eventId: randomUUID(),
        body: 'Please unsubscribe me.',
      },
      now,
    )
    assert.equal(
      (await readPilotState(db.sql, agent, now)).threads[0].handoff_state,
      'held',
    )
  },
)
withDb(
  'suppression follows confirmed aliases and prevents re-enrollment',
  async (db) => {
    const { thread } = await launched(db)
    const [party] =
      await db.sql`select party_id from em_threads where id=${thread.id}`
    const [alias] =
      await db.sql`insert into em_addresses(workspace_id,raw_address,normalized_address) values(${db.workspaceId},'alias@example.test','alias@example.test') returning id`
    await db.sql`insert into em_party_addresses(workspace_id,party_id,address_id,relationship,confirmed_at) values(${db.workspaceId},${party.party_id},${alias.id},'confirmed',${now})`
    await simulateInbound(
      db.sql,
      owner,
      {
        threadId: thread.id,
        eventId: randomUUID(),
        body: 'Please unsubscribe me.',
      },
      now,
    )
    assert.equal((await db.sql`select * from em_suppressions`).length, 2)
    assert.equal(
      (
        await db.sql`select * from em_send_intents where thread_id=${thread.id} and state='queued'`
      ).length,
      0,
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'THR-TAKEOVER',
          idempotencyKey: randomUUID(),
          payload: { threadId: thread.id, expectedControllerRevision: 1 },
        },
        now,
      ),
      'THREAD_STOPPED',
    )
    const review = await getPilotReview(
      db.sql,
      owner,
      await draft(db, 'Later'),
      now,
    )
    assert.ok(
      review.recipients
        .find((r) => r.addressId === thread.address_id)
        ?.reasons.includes('Marketing stopped'),
    )
  },
)
withDb(
  'authorization is enforced at service and HTTP boundaries; browser roles have no table privileges',
  async (db) => {
    const command = {
      command: 'CAM-CREATE',
      idempotencyKey: randomUUID(),
      payload: { name: 'No', program: 'seller_outreach' },
    }
    await rejects(
      executePilotCommand(db.sql, reader, command, now),
      'FORBIDDEN',
    )
    await rejects(
      executePilotCommand(db.sql, randomUUID(), command, now),
      'NO_EMAIL_MEMBERSHIP',
    )
    await db.sql`update em_memberships set active=false where auth_user_id=${owner}`
    await rejects(
      executePilotCommand(db.sql, owner, command, now),
      'NO_EMAIL_MEMBERSHIP',
    )
    const http = createWorkflowHttp({
      subject: async () => null,
      database: () => {
        throw new Error('Database must not be called before auth')
      },
    })
    const denied = await http.GET(
      new Request('http://localhost/api/email/workspace'),
    )
    assert.equal(denied.status, 401)
    assert.equal(emailCommandResultSchema.parse(await denied.json()).ok, false)
    assert.equal(
      (
        await http.POST(
          new Request('http://localhost/api/email/workspace', {
            method: 'POST',
            headers: {
              origin: 'https://attacker.test',
              'content-type': 'application/json',
            },
            body: JSON.stringify(command),
          }),
        )
      ).status,
      403,
    )
    const bad =
      await db.sql`select table_name,grantee from information_schema.table_privileges where table_name like 'em_%' and grantee in ('PUBLIC','anon','authenticated')`
    assert.equal(bad.length, 0)
    await assert.rejects(
      db.sql.begin(async (tx) => {
        await tx.unsafe('set local role authenticated')
        await tx.unsafe('select * from em_threads')
      }),
      /permission denied/,
    )
  },
)
withDb(
  'campaign pause holds its queued messages; global pause stops all dispatch',
  async (db) => {
    const { id } = await launched(db)
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'CAM-PAUSE',
        idempotencyKey: randomUUID(),
        entityId: id,
        payload: { reason: 'Pause' },
      },
      now,
    )
    const count = (await db.sql`select * from em_messages`).length
    await simulateDelivery(db.sql, owner, randomUUID(), now)
    assert.equal((await db.sql`select * from em_messages`).length, count)
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'SET-PAUSE',
        idempotencyKey: randomUUID(),
        payload: { reason: 'Stop' },
      },
      now,
    )
    await rejects(
      simulateDelivery(db.sql, owner, randomUUID(), now),
      'WORKSPACE_PAUSED',
    )
    assert.equal(
      (await db.sql`select send_enabled,ai_auto_enabled from em_workspaces`)[0]
        .send_enabled,
      false,
    )
  },
)
test('calendar-day follow-up stays in Chicago weekday hours across DST and weekends', () => {
  assert.equal(
    pilotFollowUp(new Date('2026-09-11T15:00:00Z')).toISOString(),
    '2026-09-21T15:00:00.000Z',
  )
  assert.equal(
    pilotFollowUp(new Date('2026-10-29T15:00:00Z')).toISOString(),
    '2026-11-06T16:00:00.000Z',
  )
  assert.equal(
    pilotFollowUp(new Date('2026-03-05T16:00:00Z')).toISOString(),
    '2026-03-13T15:00:00.000Z',
  )
})

withDb(
  'dispatch rechecks verification after publication and holds changed recipients',
  async (db) => {
    const id = await draft(db)
    await executePilotCommand(db.sql, owner, await launchCommand(db, id), now)
    await db.sql`update em_addresses set verification_expires_at='2026-01-01'`
    await simulateDelivery(db.sql, owner, randomUUID(), now)
    assert.equal((await db.sql`select * from em_messages`).length, 0)
    assert.equal(
      (await db.sql`select * from em_send_intents where state='held'`).length,
      2,
    )
    assert.equal(
      (await readPilotState(db.sql, owner, now)).threads.filter(
        (t) => t.state === 'needs_review',
      ).length,
      2,
    )
  },
)
withDb(
  'local transport enforces hourly capacity across repeat processing calls',
  async (db) => {
    const { thread } = await launched(db)
    await simulateInbound(
      db.sql,
      owner,
      {
        threadId: thread.id,
        eventId: randomUUID(),
        body: 'Can you tell me more?',
      },
      now,
    )
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-TAKEOVER',
        idempotencyKey: randomUUID(),
        payload: { threadId: thread.id, expectedControllerRevision: 0 },
      },
      now,
    )
    const current = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === thread.id,
    )!
    const draft = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-DRAFT',
        idempotencyKey: randomUUID(),
        payload: {
          threadId: thread.id,
          body: 'What would help you decide?',
          contentRevision: current.content_revision,
          controllerRevision: current.controller_revision,
        },
      },
      now,
    )
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-SEND',
        idempotencyKey: randomUUID(),
        payload: {
          draftId: draft.entityId,
          bodyHash: draft.bodyHash,
          contentRevision: current.content_revision,
          controllerRevision: current.controller_revision,
        },
      },
      now,
    )
    const reply = await simulateDelivery(db.sql, owner, randomUUID(), now)
    assert.equal(reply.state, 'accepted_simulated')
    assert.equal(
      (await simulateDelivery(db.sql, owner, randomUUID(), now)).state,
      'waiting_for_shared_capacity',
    )
    assert.equal(
      (await db.sql`select * from em_messages where direction='outbound'`)
        .length,
      2,
    )
    await simulateDelivery(
      db.sql,
      owner,
      randomUUID(),
      new Date(now.getTime() + 3600001),
    )
    assert.equal(
      (await db.sql`select * from em_messages where direction='outbound'`)
        .length,
      3,
    )
  },
)
withDb(
  'new message invalidates callback review and false phone evidence is rejected',
  async (db) => {
    const { thread } = await launched(db)
    const body = 'Call me tomorrow afternoon at 816-555-0101.'
    const message = await simulateInbound(
      db.sql,
      owner,
      { threadId: thread.id, eventId: randomUUID(), body },
      now,
    )
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-TAKEOVER',
        idempotencyKey: randomUUID(),
        payload: { threadId: thread.id, expectedControllerRevision: 0 },
      },
      now,
    )
    const command = {
      command: 'THR-HANDOFF',
      expectedRevision: 2,
      idempotencyKey: randomUUID(),
      payload: {
        threadId: thread.id,
        ownerId: owner,
        backupId: agent,
        reason: 'Call requested',
        requestedContact: { phone: '816-555-0999' },
        factEvidence: [
          { source: 'message', messageId: message.entityId, quote: body },
        ],
      },
    }
    await rejects(
      executePilotCommand(db.sql, owner, command, now),
      'PHONE_EVIDENCE_REQUIRED',
    )
    await simulateInbound(
      db.sql,
      owner,
      {
        threadId: thread.id,
        eventId: randomUUID(),
        body: 'Actually, do not call yet.',
      },
      now,
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          ...command,
          payload: {
            ...command.payload,
            requestedContact: { phone: '816-555-0101' },
          },
        },
        now,
      ),
      'NEW_REPLY_REVIEW_REQUIRED',
    )
    assert.equal((await db.sql`select * from em_handoffs`).length, 0)
  },
)
withDb('manual stop is not reported as a seller unsubscribe', async (db) => {
  const { thread } = await launched(db)
  await executePilotCommand(
    db.sql,
    owner,
    {
      command: 'SUP-ADD',
      idempotencyKey: randomUUID(),
      payload: {
        addressIds: [thread.address_id],
        scope: 'all_marketing',
        reason: 'manual',
      },
    },
    now,
  )
  const stopped = (await readPilotState(db.sql, owner, now)).threads.find(
    (t) => t.id === thread.id,
  )!
  assert.equal(stopped.state, 'stopped')
  assert.equal(stopped.outcome, 'unclassified')
})

const business = {
  name: 'SavingKC practice',
  address: '100 Sample Street, Example City',
  primaryDomain: 'savingkc.test',
  timezone: 'America/Chicago',
  programs: ['seller_outreach'],
  contact: 'team@savingkc.test',
  privacyUrl: 'https://savingkc.test/privacy',
}
withDb(
  'settings save is atomic, replayable and rejects stale revisions and nonowners',
  async (db) => {
    const command = {
      command: 'SET-BUSINESS',
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      payload: business,
    }
    await rejects(executePilotCommand(db.sql, agent, command, now), 'FORBIDDEN')
    const results = await Promise.all([
      executePilotCommand(db.sql, owner, command, now),
      executePilotCommand(db.sql, owner, command, now),
    ])
    assert.deepEqual(results[0], results[1])
    const state = await readPilotState(db.sql, owner, now)
    assert.equal(state.settings?.config.business?.name, business.name)
    assert.equal(state.settings?.revision, 1)
    assert.equal((await readPilotState(db.sql, agent, now)).settings, null)
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        { ...command, idempotencyKey: randomUUID() },
        now,
      ),
      'STALE_SETTINGS',
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        { ...command, payload: { ...business, name: 'Changed' } },
        now,
      ),
      'IDEMPOTENCY_MISMATCH',
    )
    assert.equal(
      (await db.sql`select count(*)::int as n from em_audit_events`)[0].n,
      1,
    )
    await db.sql
      .unsafe(`create function fail_setup_audit() returns trigger language plpgsql as $$ begin raise exception 'injected audit failure'; end $$;
    create trigger fail_setup_audit before insert on em_audit_events for each row execute function fail_setup_audit();`)
    await assert.rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          ...command,
          idempotencyKey: randomUUID(),
          expectedRevision: 1,
          payload: { ...business, name: 'Must roll back' },
        },
        now,
      ),
      /injected audit failure/,
    )
    assert.equal(
      (await readPilotState(db.sql, owner, now)).settings?.config.business
        ?.name,
      business.name,
    )
    assert.equal(
      (await db.sql`select count(*)::int as n from em_command_receipts`)[0].n,
      1,
    )
  },
)
withDb(
  'settings ignores forged readiness; pause works for operators even in disabled mode',
  async (db) => {
    const runId = randomUUID()
    await db.sql`update em_workspaces set config=${db.sql.json({ readiness: { runId, state: 'current', configHash: 'forged-config-hash', checkedAt: now.toISOString() } })},execution_mode='disabled'`
    for (const command of ['SET-ENABLE', 'SET-FINISH'])
      await rejects(
        executePilotCommand(
          db.sql,
          owner,
          {
            command,
            idempotencyKey: randomUUID(),
            payload: {
              readinessRunId: runId,
              configHash: 'forged-config-hash',
            },
          },
          now,
        ),
        'PROVIDER_READINESS_UNAVAILABLE',
      )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'SET-AUTOMATION',
          idempotencyKey: randomUUID(),
          expectedRevision: 0,
          payload: {
            mode: 'bounded_auto',
            playbookVersionId: randomUUID(),
            maxReplies: 1,
            language: 'en',
            allowedActions: [],
          },
        },
        now,
      ),
      'AUTOMATION_READINESS_REQUIRED',
    )
    await executePilotCommand(
      db.sql,
      agent,
      {
        command: 'SET-PAUSE',
        idempotencyKey: randomUUID(),
        payload: { reason: 'Operator saw a problem' },
      },
      now,
    )
    await rejects(
      executePilotCommand(
        db.sql,
        reader,
        {
          command: 'SET-PAUSE',
          idempotencyKey: randomUUID(),
          payload: { reason: 'No access' },
        },
        now,
      ),
      'FORBIDDEN',
    )
    const [ws] = await db.sql`select * from em_workspaces`
    assert.equal(ws.send_enabled, false)
    assert.equal(ws.ai_auto_enabled, false)
    assert.equal(ws.setup_completed_at, null)
    assert.equal(ws.pause_reason, 'Operator saw a problem')
  },
)
withDb(
  'team setup validates actual CRM roles, weekday hours, distinct backup and manual calendar',
  async (db) => {
    const payload = {
      reviewerId: owner,
      acquisitionOwnerId: agent,
      backupId: owner,
      hours: {
        timezone: 'America/Chicago',
        weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        startLocal: '09:00',
        endLocal: '17:00',
      },
      sla: { urgentMinutes: 15, ordinaryMinutes: 120 },
      calendarMode: 'manual',
    }
    const make = (patch = {}) => ({
      command: 'SET-TEAM',
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      payload: { ...payload, ...patch },
    })
    await rejects(
      executePilotCommand(db.sql, owner, make({ reviewerId: reader }), now),
      'TEAM_ROLE_REQUIRED',
    )
    await rejects(
      executePilotCommand(db.sql, owner, make({ backupId: agent }), now),
      'DISTINCT_BACKUP_REQUIRED',
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        make({ hours: { ...payload.hours, startLocal: '08:00' } }),
        now,
      ),
      'INVALID_TEAM_HOURS',
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        make({ hours: { ...payload.hours, endLocal: '25:00' } }),
        now,
      ),
      'INVALID_TEAM_HOURS',
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        make({ calendarMode: 'connected' }),
        now,
      ),
      'CALENDAR_NOT_CONNECTED',
    )
    await executePilotCommand(db.sql, owner, make(), now)
    assert.equal(
      (await readPilotState(db.sql, owner, now)).settings?.config.team
        ?.acquisitionOwnerId,
      agent,
    )
    assert.deepEqual((await readPilotState(db.sql, agent, now)).routing, {
      acquisitionOwnerId: agent,
      backupId: owner,
    })
    await db.sql`update agent_profiles set is_active=false where id=${agent}`
    await rejects(
      executePilotCommand(
        db.sql,
        agent,
        {
          command: 'SET-PAUSE',
          idempotencyKey: randomUUID(),
          payload: { reason: 'Inactive CRM account' },
        },
        now,
      ),
      'NO_EMAIL_MEMBERSHIP',
    )
  },
)
withDb(
  'simultaneous owner removals serialize and retain one active owner',
  async (db) => {
    await db.sql`update em_memberships set roles=array['owner'] where auth_user_id=${agent}`
    const settings = (await readPilotState(db.sql, owner, now)).settings!
    const remove = (id: string) => {
      const m = settings.members.find((m) => m.id === id)!
      return {
        command: 'SET-ROLES',
        idempotencyKey: randomUUID(),
        expectedRevision: m.revision,
        payload: {
          authUserId: id,
          roles: ['reader'],
          active: true,
          affectedWorkHash: m.affectedWorkHash,
        },
      }
    }
    const results = await Promise.allSettled([
      executePilotCommand(db.sql, owner, remove(agent), now),
      executePilotCommand(db.sql, agent, remove(owner), now),
    ])
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1)
    assert.equal(
      (
        await db.sql`select count(*)::int as n from em_memberships where active and roles @> array['owner']`
      )[0].n,
      1,
    )
  },
)
withDb(
  'role reduction reviews current work and cancels pending work without AI reassignment',
  async (db) => {
    const { thread } = await launched(db)
    // Give the agent ownership of a live practice conversation and queued work.
    await db.sql`update em_threads set responsible_user_id=${agent} where id=${thread.id}`
    const stale = (
      await readPilotState(db.sql, owner, now)
    ).settings!.members.find((m) => m.id === agent)!
    await simulateInbound(
      db.sql,
      owner,
      {
        threadId: thread.id,
        eventId: randomUUID(),
        body: 'Could we speak tomorrow?',
      },
      now,
    )
    const make = (m: typeof stale) => ({
      command: 'SET-ROLES',
      idempotencyKey: randomUUID(),
      expectedRevision: m.revision,
      payload: {
        authUserId: agent,
        roles: ['reader'],
        active: true,
        affectedWorkHash: m.affectedWorkHash,
      },
    })
    await rejects(
      executePilotCommand(db.sql, owner, make(stale), now),
      'AFFECTED_WORK_CHANGED',
    )
    await executePilotCommand(
      db.sql,
      agent,
      {
        command: 'THR-TAKEOVER',
        idempotencyKey: randomUUID(),
        payload: { threadId: thread.id, expectedControllerRevision: 0 },
      },
      now,
    )
    const current = (
      await readPilotState(db.sql, owner, now)
    ).settings!.members.find((m) => m.id === agent)!
    await executePilotCommand(db.sql, owner, make(current), now)
    const [saved] = await db.sql`select * from em_threads where id=${thread.id}`
    assert.equal(saved.controller, 'none')
    assert.equal(saved.state, 'needs_review')
    assert.equal(
      (await db.sql`select count(*)::int as n from em_membership_holds`)[0].n,
      1,
    )
    assert.equal(
      (
        await db.sql`select count(*)::int as n from em_send_intents where thread_id=${thread.id} and state='queued'`
      )[0].n,
      0,
    )
    assert.equal(
      (
        await db.sql`select count(*)::int as n from em_notifications where recipient_id=${owner} and kind='team_member_work_held'`
      )[0].n,
      1,
    )
    await rejects(
      executePilotCommand(
        db.sql,
        agent,
        {
          command: 'THR-TAKEOVER',
          idempotencyKey: randomUUID(),
          payload: {
            threadId: thread.id,
            expectedControllerRevision: saved.controller_revision,
          },
        },
        now,
      ),
      'FORBIDDEN',
    )
  },
)

withDb(
  'CRM deactivation blocks queued dispatch and invalidates callback routing choices',
  async (db) => {
    const { thread } = await launched(db)
    await db.sql`update em_threads set responsible_user_id=${agent}`
    await db.sql`update agent_profiles set is_active=false where id=${agent}`
    await simulateDelivery(
      db.sql,
      owner,
      randomUUID(),
      new Date(now.getTime() + 1_000),
    )
    assert.equal(
      (
        await db.sql`select count(*)::int as n from em_send_intents where state='held' and cancellation_reason='readiness_changed'`
      )[0].n,
      1,
    )
    const state = await readPilotState(db.sql, owner, now)
    assert.equal(
      state.members.some((m) => m.id === agent),
      false,
    )
    assert.equal(state.routing, null)
    assert.equal(
      state.threads.some((t) => t.id === thread.id),
      true,
    )
  },
)
