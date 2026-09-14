import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDisposableDatabase, fixtureOwner as owner, fixtureAgent as agent, fixtureNow } from '../email-local/database.mjs'
import { executePilotCommand, readPilotState, simulateInbound } from '../../src/lib/email/workflow/service'
import { reviewedCallback } from '../email-local/callback-fixture'
const now = new Date(fixtureNow)
type Database = Awaited<ReturnType<typeof startDisposableDatabase>>
const withDb = (name: string, run: (db: Database) => Promise<void>) => test(name, async () => {
  const db = await startDisposableDatabase()
  try { await run(db) } finally { await db.stop() }
})

const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof Error && e.message === code,
  )



for (const testOnly of [false, true]) withDb(
  `post-unsubscribe callback review preserves suppression (${testOnly ? 'test' : 'seller'})`,
  async db => {
    if (!testOnly) await db.sql`update agent_profiles set email='casey@savingkc.com',full_name='Casey Davis' where id=${db.profileIds.agent}`
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
      assert.equal((await db.sql`select assigned_to from work_items where source_id=${handoff.crm_task_id}`)[0].assigned_to, 'Casey')
      assert.equal((await readPilotState(db.sql, owner, at)).threads.find(t => t.id === threadId)?.callback_owner_changed, false)
    }
    const stoppedAgain = new Date(at.getTime() + 10000)
    await executePilotCommand(db.sql, owner, { command: 'SUP-ADD', idempotencyKey: randomUUID(), payload: { addressIds: [initial.address_id], scope: 'all_marketing', reason: 'unsubscribe' } }, stoppedAgain)
    assert.equal((await readPilotState(db.sql, owner, stoppedAgain)).threads.find(t => t.id === threadId)?.callback_request, null)
    await rejects(executePilotCommand(db.sql, owner, { ...command, idempotencyKey: randomUUID() }, stoppedAgain), 'NEW_CALLBACK_REQUEST_REQUIRED')
  },
)
