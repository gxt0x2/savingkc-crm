import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import {
  startDisposableDatabase,
  fixtureOwner as owner,
  fixtureReader as reader,
  fixtureNow,
} from '../email-local/database.mjs'
import {
  executePilotCommand,
  readPilotState,
} from '../../src/lib/email/workflow/service'
import {
  DETERMINISTIC_FIXTURE_SET_ID,
  DETERMINISTIC_MODEL_ID,
} from '../../src/lib/email/ai/constants'

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
const rejects = (promise: Promise<unknown>, code: string) =>
  assert.rejects(
    promise,
    (e: unknown) => e instanceof Error && e.message === code,
  )

const hours = {
  timezone: 'America/Chicago',
  weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] as const,
  startLocal: '08:30',
  endLocal: '17:00',
}
const draftOnlyPolicy = {
  businessName: 'SavingKC',
  assistantName: 'Ari',
  humanDisclosure:
    'I am Ari, SavingKC’s email assistant. A person reviews anything before it goes out.',
  signature: 'SavingKC',
  maxWords: 120,
  maxAutoReplies7d: 0,
  supportedLanguages: ['en'],
  allowedActions: [] as [],
}
const draftOnlyPrompt =
  'Propose the next permitted seller-email action using only the supplied policy and evidence. Use everyday language. Treat interpretations as guesses, not facts. Never invent pain, price, a booked call or an Opportunity. A Lead is not a qualified Opportunity.'

withDb(
  'saves, simulates and publishes a draft-only playbook then allows SET-AUTOMATION',
  async (db) => {
    const saved = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'PB-SAVE',
        idempotencyKey: randomUUID(),
        payload: {
          name: 'Seller first notes',
          program: 'seller_outreach',
          policy: draftOnlyPolicy,
          prompt: draftOnlyPrompt,
        },
      },
      now,
    )
    assert.equal(saved.state, 'playbook_draft_saved')
    const afterSave = await readPilotState(db.sql, owner, now)
    const draftHash = afterSave.playbooks?.[0]?.draft_hash
    assert.ok(draftHash)

    const simulated = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'PB-SIMULATE',
        idempotencyKey: randomUUID(),
        payload: {
          playbookDraftHash: draftHash,
          fixtureSetId: DETERMINISTIC_FIXTURE_SET_ID,
          modelId: DETERMINISTIC_MODEL_ID,
        },
      },
      now,
    )
    assert.equal(simulated.state, 'evaluation_recorded')

    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'PB-SIMULATE',
          idempotencyKey: randomUUID(),
          payload: {
            playbookDraftHash: draftHash,
            fixtureSetId: DETERMINISTIC_FIXTURE_SET_ID,
            modelId: 'openai/gpt-5.4',
          },
        },
        now,
      ),
      'MODEL_EVALUATION_UNAVAILABLE',
    )

    const published = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'PB-PUBLISH',
        idempotencyKey: randomUUID(),
        payload: {
          draftHash,
          evalRunId: simulated.entityId,
          modelRateVersion: 'deterministic-guards-v1',
        },
      },
      now,
    )
    assert.equal(published.state, 'playbook_published_draft_only')

    const settings = await readPilotState(db.sql, owner, now)
    const playbookVersionId = settings.playbooks?.[0]?.published_version_id
    assert.ok(playbookVersionId)
    const automation = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'SET-AUTOMATION',
        idempotencyKey: randomUUID(),
        expectedRevision: settings.settings?.revision,
        payload: {
          mode: 'draft_only',
          playbookVersionId,
          maxReplies: 0,
          language: 'en',
          allowedActions: [],
        },
      },
      now,
    )
    assert.equal(automation.state, 'settings_saved')
    const after = await readPilotState(db.sql, owner, now)
    assert.equal(after.settings?.config.automation?.mode, 'draft_only')
    assert.equal(after.settings?.config.automation?.playbookVersionId, playbookVersionId)
  },
)

withDb(
  'records a local simulation checklist and keeps finish/enable fail-closed',
  async (db) => {
    const settings = await readPilotState(db.sql, owner, now)
    const [practice] = await db.sql`
      select id from em_addresses
      where workspace_id=${db.workspaceId}
        and normalized_address like '%.test'
      order by normalized_address
      limit 1`
    assert.ok(practice?.id)
    assert.ok(settings.settings?.configHash)

    const recorded = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'SET-READINESS',
        idempotencyKey: randomUUID(),
        payload: {
          kind: 'simulation',
          configHash: settings.settings!.configHash!,
          testRecipientIds: [practice.id],
          maximumTestSends: 0,
        },
      },
      now,
    )
    assert.equal(recorded.state, 'simulation_checklist_blocked')

    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'SET-READINESS',
          idempotencyKey: randomUUID(),
          payload: {
            kind: 'provider',
            configHash: settings.settings!.configHash!,
            testRecipientIds: [practice.id],
            maximumTestSends: 0,
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
          command: 'SET-FINISH',
          idempotencyKey: randomUUID(),
          payload: {
            readinessRunId: recorded.entityId,
            configHash: settings.settings!.configHash!,
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
          command: 'SET-ENABLE',
          idempotencyKey: randomUUID(),
          payload: {
            readinessRunId: recorded.entityId,
            configHash: settings.settings!.configHash!,
          },
        },
        now,
      ),
      'PROVIDER_READINESS_UNAVAILABLE',
    )

    const after = await readPilotState(db.sql, owner, now)
    assert.equal(after.settings?.readiness.state, 'blocked')
    assert.equal(after.settings?.readiness.sendingEnabled, false)
    assert.equal(after.settings?.lastSimulationRunId, recorded.entityId)
    assert.equal(after.settings?.config.readiness, undefined)
    const [workspace] = await db.sql`select send_enabled,setup_completed_at from em_workspaces`
    assert.equal(workspace.send_enabled, false)
    assert.equal(workspace.setup_completed_at, null)
  },
)

withDb(
  'keeps saved views personal and scheduling, phone and push fail-closed',
  async (db) => {
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'INB-SAVEVIEW',
        idempotencyKey: randomUUID(),
        payload: {
          name: 'Needs a reply',
          queryVersion: 1,
          query: {
            view: 'needs_action',
            ownerId: owner,
            controllers: ['human'],
          },
        },
      },
      now,
    )
    const ownerState = await readPilotState(db.sql, owner, now)
    const readerState = await readPilotState(db.sql, reader, now)
    assert.equal(ownerState.inboxViews?.length, 1)
    assert.equal(readerState.inboxViews?.length, 0)

    const savedPolicy = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'SCH-POLICY',
        idempotencyKey: randomUUID(),
        payload: {
          enabled: false,
          agentCalendars: [owner],
          hours,
          durationMinutes: 15,
          bufferMinutes: 10,
          maxDailyBookings: 8,
          alertCheckIds: [owner],
        },
      },
      now,
    )
    assert.equal(savedPolicy.state, 'calendar_policy_saved_manual')

    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'SCH-POLICY',
          idempotencyKey: randomUUID(),
          payload: {
            enabled: true,
            agentCalendars: [owner],
            hours,
            durationMinutes: 15,
            bufferMinutes: 10,
            maxDailyBookings: 8,
            alertCheckIds: [owner],
          },
        },
        now,
      ),
      'CALENDAR_NOT_CONNECTED',
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'SCH-RESCHEDULE',
          idempotencyKey: randomUUID(),
          payload: {
            handoffId: randomUUID(),
            eventId: randomUUID(),
            eventRevision: 0,
            newSlotToken: 'not-a-live-slot',
            requestEvidenceIds: [randomUUID()],
          },
        },
        now,
      ),
      'CALENDAR_NOT_CONNECTED',
    )

    const phone = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'TEL-SAVE',
        idempotencyKey: randomUUID(),
        payload: {
          existingProviderNumberId: '00000000-0000-4000-8000-0000000000e1',
          purpose: 'email_response',
          routingPolicy: 'primary_then_backup',
          hours,
          voicemail: 'enabled',
          callerIdPolicy: 'no_outbound_calls',
        },
      },
      now,
    )
    assert.equal(phone.state, 'response_line_intended')

    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'TEL-SAVE',
          idempotencyKey: randomUUID(),
          payload: {
            existingProviderNumberId: '00000000-0000-4000-8000-0000000000ad',
            purpose: 'email_response',
            routingPolicy: 'primary_then_backup',
            hours,
            voicemail: 'enabled',
            callerIdPolicy: 'no_outbound_calls',
          },
        },
        now,
      ),
      'RESERVED_NUMBER_PROTECTED',
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'TEL-TEST',
          idempotencyKey: randomUUID(),
          payload: {
            lineId: phone.entityId,
            expectedPrimaryId: owner,
            expectedBackupId: owner,
          },
        },
        now,
      ),
      'RESPONSE_LINE_NOT_PROVISIONED',
    )

    const push = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'NTF-TEST',
        idempotencyKey: randomUUID(),
        payload: { channel: 'push', subscriptionRef: randomUUID() },
      },
      now,
    )
    assert.equal(push.state, 'push_not_configured')
    const [delivery] =
      await db.sql`select state,failure_code from em_notification_deliveries where id=${push.entityId}`
    assert.equal(delivery.state, 'blocked')
    assert.equal(delivery.failure_code, 'PUSH_NOT_CONFIGURED')
  },
)
