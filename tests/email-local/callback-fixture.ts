import { randomUUID } from 'node:crypto'
import { startDisposableDatabase, fixtureOwner as owner, fixtureAgent as agent, fixtureNow } from './database.mjs'
import { executePilotCommand, getPilotReview, readPilotState, simulateDelivery, simulateInbound } from '../../src/lib/email/workflow/service'
import type { PilotConfig } from '../../src/lib/email/workflow/types'
const now = new Date(fixtureNow)
type Database = Awaited<ReturnType<typeof startDisposableDatabase>>
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
async function launched(db: Database, name = 'Pilot') {
  const id = await draft(db, name)
  await executePilotCommand(db.sql, owner, await launchCommand(db, id), now)
  await simulateDelivery(db.sql, owner, randomUUID(), now)
  const state = await readPilotState(db.sql, owner, now)
  const thread = state.threads.find((row) => row.campaign_id === id)!
  const message = state.messages.find((row) => row.thread_id === thread.id)!
  return {
    id,
    thread,
    message,
  }
}
export async function reviewedCallback(
  db: Database,
  body = 'I would consider selling this property. Please call me.',
  campaignName = 'Pilot',
) {
  const { thread } = await launched(db, campaignName)
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
