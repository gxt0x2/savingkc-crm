import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { executePilotCommand, readPilotState } from '../../src/lib/email/workflow/service'
import { reviewedCallback } from '../email-local/callback-fixture'
import { fixtureAgent as agent, fixtureNow, fixtureOwner as owner, startDisposableDatabase } from '../email-local/database.mjs'

const now = new Date(fixtureNow)
const withDb = (name: string, run: (db: Awaited<ReturnType<typeof startDisposableDatabase>>) => Promise<void>) =>
  test(name, async () => {
    const db = await startDisposableDatabase()
    try { await run(db) } finally { await db.stop() }
  })

withDb('ordinary campaigns cannot use the controlled-test callback outcome', async (db) => {
  const ordinary = await reviewedCallback(db)
  const handoff = await executePilotCommand(db.sql, owner, ordinary, now)
  const thread = (await readPilotState(db.sql, agent, now)).threads.find((row) => row.id === ordinary.payload.threadId)!
  await assert.rejects(
    executePilotCommand(db.sql, agent, {
      command: 'HAN-OUTCOME', idempotencyKey: randomUUID(), expectedRevision: 0,
      payload: { handoffId: handoff.entityId, outcome: 'controlled_test_complete', note: 'No seller call occurred.', contentRevision: thread.content_revision },
    }, now),
    (error: unknown) => error instanceof Error && error.message === 'CONTROLLED_TEST_OUTCOME_REQUIRED',
  )
})

withDb('controlled callback tests close honestly without recording a seller call', async (db) => {
  const controlled = await reviewedCallback(db, 'I would consider selling. Please call me.', 'Controlled setup test')
  const handoff = await executePilotCommand(db.sql, owner, controlled, now)
  const thread = (await readPilotState(db.sql, agent, now)).threads.find((row) => row.id === controlled.payload.threadId)!
  const result = await executePilotCommand(db.sql, agent, {
    command: 'HAN-OUTCOME', idempotencyKey: randomUUID(), expectedRevision: 0,
    payload: { handoffId: handoff.entityId, outcome: 'controlled_test_complete', note: 'Controlled workflow verification completed; no seller call occurred.', contentRevision: thread.content_revision },
  }, now)
  assert.equal(result.state, 'callback_completed')
  assert.equal((await db.sql`select status from work_items where lead_id=${thread.lead_id}`)[0].status, 'completed')
  assert.equal((await db.sql`select state from em_threads where id=${thread.id}`)[0].state, 'done')
  const [note] = await db.sql`select description,metadata from lead_activities where lead_id=${thread.lead_id} and activity_type='note' order by created_at desc limit 1`
  assert.match(note.description, /no seller call occurred/i)
  assert.equal(note.metadata.email_outcome, 'controlled_test_complete')
})
