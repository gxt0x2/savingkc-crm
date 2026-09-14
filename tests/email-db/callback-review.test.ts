import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDisposableDatabase, fixtureOwner as owner, fixtureAgent as agent, fixtureNow } from '../email-local/database.mjs'
import { executePilotCommand, getPilotReview, readPilotState, simulateDelivery, simulateInbound } from '../../src/lib/email/workflow/service'
import type { PilotConfig } from '../../src/lib/email/workflow/types'
const now = new Date(fixtureNow)
type Database = Awaited<ReturnType<typeof startDisposableDatabase>>
const withDb = (name: string, run: (db: Database) => Promise<void>) => test(name, async () => {
  const db = await startDisposableDatabase()
  try { await run(db) } finally { await db.stop() }
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

async function reviewedCallback(
  db: Database,
  body = 'I would consider selling this property. Please call me.',
) {
  const { thread } = await launched(db)
  const inbound = await simulateInbound(
    db.sql,
    owner,
    { threadId: thread.id, eventId: randomUUID(), body },
    new Date(now.getTime() + 1000),
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
  return {
    command: 'THR-HANDOFF',
    expectedRevision: 2,
    idempotencyKey: randomUUID(),
    payload: {
      threadId: thread.id,
      ownerId: agent,
      backupId: owner,
      reason: 'Reviewed seller interest',
      positiveSellerInterest: true,
      requestedContact: {},
      factEvidence: [
        { source: 'message', messageId: inbound.entityId, quote: body },
      ],
    },
  }
}


for (const testOnly of [false, true]) withDb(
  `post-unsubscribe callback review preserves suppression (${testOnly ? 'test' : 'seller'})`,
  async db => {
    const command = await reviewedCallback(db, 'Call me at 816-555-0101 tomorrow afternoon.')
    const threadId = command.payload.threadId
    const [initial] = await db.sql`select * from em_threads where id=${threadId}`
    const stopAt = new Date(now.getTime() + 10000)
    await executePilotCommand(db.sql, owner, { command: 'SUP-ADD', idempotencyKey: randomUUID(), payload: { addressIds: [initial.address_id], scope: 'all_marketing', reason: 'unsubscribe' } }, stopAt)
    await rejects(executePilotCommand(db.sql, owner, command, stopAt), 'NEW_CALLBACK_REQUEST_REQUIRED')
    const body = `${testOnly ? 'SYSTEM TEST — ' : ''}Call me at 816-555-0101 tomorrow afternoon.${testOnly ? ' False number.' : ''}`
    const at = new Date(stopAt.getTime() + 10000)
    const inbound = await simulateInbound(db.sql, owner, { threadId, eventId: randomUUID(), body }, at)
    let current = (await readPilotState(db.sql, owner, at)).threads.find(t => t.id === threadId)!
    assert.equal(current.state, 'stopped')
    assert.equal(current.callback_request?.testOnly, testOnly)
    await executePilotCommand(db.sql, owner, { command: 'THR-TAKEOVER', idempotencyKey: randomUUID(), payload: { threadId, expectedControllerRevision: current.controller_revision } }, at)
    current = (await readPilotState(db.sql, owner, at)).threads.find(t => t.id === threadId)!
    assert.equal(current.state, 'stopped')
    await rejects(executePilotCommand(db.sql, owner, { command: 'THR-DRAFT', idempotencyKey: randomUUID(), payload: { threadId, body: 'Should not send', contentRevision: current.content_revision, controllerRevision: current.controller_revision } }, at), 'THREAD_STOPPED')
    const before = await db.sql`select id from leads`
    command.expectedRevision = current.content_revision
    command.payload.requestedContact = { phone: '816-555-0101', requestedTimeText: 'tomorrow afternoon' }
    command.payload.factEvidence = [{ source: 'message', messageId: inbound.entityId, quote: body }]
    const result = await executePilotCommand(db.sql, owner, command, at)
    assert.equal(result.state, testOnly ? 'test_callback_reviewed' : 'handoff_saved_crm_synced')
    assert.equal((await db.sql`select * from em_suppressions where address_id=${initial.address_id}`).length, 1)
    assert.equal((await db.sql`select state from em_threads where id=${threadId}`)[0].state, 'stopped')
    assert.equal((await db.sql`select id from em_send_intents where thread_id=${threadId} and state='queued'`).length, 0)
    if (testOnly) {
      assert.equal((await db.sql`select id from leads`).length, before.length)
      assert.equal((await db.sql`select id from em_handoffs where thread_id=${threadId}`).length, 0)
      assert.equal((await readPilotState(db.sql, owner, at)).threads.find(t => t.id === threadId)?.callback_request?.reviewed, true)
      await executePilotCommand(db.sql, owner, { ...command, idempotencyKey: randomUUID() }, at)
      assert.equal((await db.sql`select id from em_notifications where logical_key=${`test-callback:${inbound.entityId}`}`).length, 1)
    } else {
      const [handoff] = await db.sql`select owner_id,crm_task_id from em_handoffs where thread_id=${threadId}`
      assert.equal(handoff.owner_id, agent)
      assert.ok(handoff.crm_task_id)
    }
    const stoppedAgain = new Date(at.getTime() + 10000)
    await executePilotCommand(db.sql, owner, { command: 'SUP-ADD', idempotencyKey: randomUUID(), payload: { addressIds: [initial.address_id], scope: 'all_marketing', reason: 'unsubscribe' } }, stoppedAgain)
    assert.equal((await readPilotState(db.sql, owner, stoppedAgain)).threads.find(t => t.id === threadId)?.callback_request, null)
    await rejects(executePilotCommand(db.sql, owner, { ...command, idempotencyKey: randomUUID() }, stoppedAgain), 'NEW_CALLBACK_REQUEST_REQUIRED')
  },
)
