import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
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
  simulateHandoffEscalation,
  simulateInbound,
} from '../../src/lib/email/workflow/service'
import { emailCommandResultSchema } from '../../src/lib/email/contracts'
import { createWorkflowHttp } from '../../src/lib/email/workflow/http'
import {
  pilotFollowUp,
  pilotCallbackDue,
} from '../../src/lib/email/workflow/schedule'
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

withDb(
  'focused actions persist canonical notes and fenced manual callbacks without qualification',
  async (db) => {
    const command = await reviewedCallback(db)
    command.payload.ownerId = owner
    command.payload.backupId = agent
    const result = await executePilotCommand(db.sql, owner, command, now)
    const threadId = command.payload.threadId
    const [thread] = await db.sql`select * from em_threads where id=${threadId}`
    const note = {
      command: 'THR-NOTE',
      idempotencyKey: randomUUID(),
      payload: { threadId, body: 'Seller prefers afternoons.' },
    }
    await rejects(executePilotCommand(db.sql, reader, note, now), 'FORBIDDEN')
    await executePilotCommand(db.sql, owner, note, now)
    await executePilotCommand(db.sql, owner, note, now)
    assert.equal(
      (await db.sql`select * from lead_activities where activity_type='note'`)
        .length,
      1,
    )
    const schedule = {
      command: 'HAN-SCHEDULE',
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      payload: {
        handoffId: result.entityId,
        mode: 'task',
        title: 'Call seller to confirm timing',
        note: 'Ask which afternoon time works best.',
        startAt: '2026-09-15T19:00:00Z',
        timezone: 'America/Chicago',
        contentRevision: thread.content_revision,
      },
    }
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        { ...schedule, payload: { ...schedule.payload, mode: 'calendar' } },
        now,
      ),
      'CALENDAR_NOT_CONNECTED',
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          ...schedule,
          payload: { ...schedule.payload, startAt: '2026-09-19T19:00:00Z' },
        },
        now,
      ),
      'INVALID_CALLBACK_TIME',
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          ...schedule,
          payload: { ...schedule.payload, startAt: '2026-09-15T12:00:00Z' },
        },
        now,
      ),
      'INVALID_CALLBACK_TIME',
    )
    const first = await executePilotCommand(db.sql, owner, schedule, now)
    assert.deepEqual(
      await executePilotCommand(db.sql, owner, schedule, now),
      first,
    )
    assert.equal(first.state, 'callback_scheduled')
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        { ...schedule, idempotencyKey: randomUUID() },
        now,
      ),
      'HANDOFF_CHANGED',
    )
    const state = await readPilotState(db.sql, owner, now)
    assert.ok(state.threads.find((t) => t.id === threadId)?.property?.address)
    assert.equal(state.threads.find((t) => t.id === threadId)?.notes?.length, 1)
    assert.equal(
      new Date(
        state.threads.find((t) => t.id === threadId)!.scheduled_for!,
      ).toISOString(),
      '2026-09-15T19:00:00.000Z',
    )
    assert.equal(
      state.threads.find((t) => t.id === threadId)?.callback_title,
      'Call seller to confirm timing',
    )
    assert.equal(
      state.threads.find((t) => t.id === threadId)?.callback_notes,
      'Ask which afternoon time works best.',
    )
    const [work] = await db.sql`select * from work_items`
    assert.equal(work.title, 'Call seller to confirm timing')
    assert.equal(
      new Date(work.due_at).toISOString(),
      '2026-09-15T19:00:00.000Z',
    )
    await simulateInbound(
      db.sql,
      owner,
      {
        threadId,
        eventId: randomUUID(),
        body: 'Actually, I have another question.',
      },
      now,
    )
    const outcome = {
      command: 'HAN-OUTCOME',
      expectedRevision: 1,
      idempotencyKey: randomUUID(),
      payload: {
        handoffId: result.entityId,
        outcome: 'conversation_complete',
        note: 'Spoke with seller; no further follow-up requested.',
        contentRevision: thread.content_revision,
      },
    }
    await rejects(
      executePilotCommand(db.sql, owner, outcome, now),
      'NEW_REPLY_REVIEW_REQUIRED',
    )
    await executePilotCommand(
      db.sql,
      owner,
      {
        ...outcome,
        payload: {
          ...outcome.payload,
          contentRevision: thread.content_revision + 1,
        },
      },
      now,
    )
    assert.equal(
      (await db.sql`select status from work_items`)[0].status,
      'completed',
    )
    assert.equal(
      (await db.sql`select station from leads`)[0].station,
      'contacted',
    )
    assert.equal(
      (await db.sql`select state from em_threads where id=${threadId}`)[0]
        .state,
      'done',
    )
    await simulateInbound(
      db.sql,
      owner,
      { threadId, eventId: randomUUID(), body: 'Unsubscribe me.' },
      now,
    )
    assert.equal(
      (await db.sql`select state from em_handoffs`)[0].state,
      'completed',
    )
    assert.equal(
      (await db.sql`select status from work_items`)[0].status,
      'completed',
    )
  },
)

withDb(
  'callback update checks current canonical owner and rolls back a broken task projection',
  async (db) => {
    const command = await reviewedCallback(db)
    command.payload.ownerId = owner
    command.payload.backupId = agent
    const result = await executePilotCommand(db.sql, owner, command, now)
    const [t] =
      await db.sql`select * from em_threads where id=${command.payload.threadId}`
    const schedule = {
      command: 'HAN-SCHEDULE',
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      payload: {
        handoffId: result.entityId,
        mode: 'task',
        startAt: '2026-09-15T19:00:00Z',
        timezone: 'America/Chicago',
        contentRevision: t.content_revision,
      },
    }
    await db.sql`update leads set assigned_agent='Demo agent' where id=${t.lead_id}`
    await rejects(
      executePilotCommand(db.sql, owner, schedule, now),
      'CALLBACK_OWNER_CHANGED',
    )
    await db.sql`update leads set assigned_agent='Demo owner' where id=${t.lead_id}`
    await db.sql
      .unsafe(`create function fixture_fail_update() returns trigger language plpgsql as $$ begin raise exception 'fixture task outage'; end $$;
    create trigger fixture_update_failure before update on work_items for each row execute function fixture_fail_update()`)
    await assert.rejects(
      executePilotCommand(db.sql, owner, schedule, now),
      /fixture task outage/,
    )
    const [h] = await db.sql`select revision,scheduled_for from em_handoffs`
    assert.equal(h.revision, 0)
    assert.equal(h.scheduled_for, null)
  },
)
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

async function existingLead(
  db: Database,
  threadId: string,
  station = 'qualified',
  assigned = 'Demo agent',
) {
  const [facts] =
    await db.sql`select p.display_name,a.normalized_address as email_address,cp.* from em_threads t
    join em_parties p on p.id=t.party_id join em_addresses a on a.id=t.address_id
    join em_party_properties ep on ep.party_id=p.id join crm_properties cp on cp.id=ep.canonical_property_id
    where t.id=${threadId}`
  const [lead] =
    await db.sql`insert into leads(full_name,email,phone,property_address,city,state,zip,
    source,station,classification,priority,assigned_agent,is_parked)
    values(${facts.display_name},${facts.email_address},null,${facts.address},${facts.city},${facts.state},${facts.zip},
      'legacy_partner',${station},${station === 'qualified' ? 'opportunity' : 'lead'},'warm',${assigned},false) returning id`
  await db.sql`select refresh_crm_entity_for_lead(${lead.id})`
  return lead.id
}

withDb(
  'CRM bridge preserves an existing Opportunity and its source, with one shared Lead history',
  async (db) => {
    const command = await reviewedCallback(db)
    const id = await existingLead(db, command.payload.threadId)
    const result = await executePilotCommand(db.sql, owner, command, now)
    assert.equal(result.state, 'handoff_saved_crm_synced')
    const [lead] = await db.sql`select * from leads`
    assert.equal(lead.id, id)
    assert.equal(lead.station, 'qualified')
    assert.equal(lead.classification, 'opportunity')
    assert.equal(lead.source, 'legacy_partner')
    assert.equal(
      (await db.sql`select * from em_crm_handoff_projections`).length,
      1,
    )
    const history =
      await db.sql`select * from lead_activities where activity_type='email'`
    assert.equal(history.length, 2)
    assert.ok(history.every((m) => m.lead_id === id))
    assert.ok(history.some((m) => m.metadata.direction === 'inbound'))
    const [thread] =
      await db.sql`select * from conversation_thread_state where thread_key=${'lead:' + id}`
    assert.equal(thread.channel, 'email')
    assert.equal(thread.attention_state, 'needs_reply')
  },
)

for (const [label, change, reason] of [
  [
    'unconfirmed identity',
    async (db: Database, id: string) => {
      await db.sql`update em_parties set identity_state='unresolved' where id=(select party_id from em_threads where id=${id})`
    },
    'identity_unconfirmed',
  ],
  [
    'buyer',
    async (db: Database, id: string) => {
      await db.sql`update em_parties set kind='buyer' where id=(select party_id from em_threads where id=${id})`
    },
    'identity_unconfirmed',
  ],
  [
    'unconfirmed property',
    async (db: Database, id: string) => {
      await db.sql`update em_party_properties set relationship='unconfirmed' where party_id=(select party_id from em_threads where id=${id})`
    },
    'property_unconfirmed',
  ],
  [
    'shared address',
    async (db: Database, id: string) => {
      await db.sql`update em_party_addresses set relationship='shared' where address_id=(select address_id from em_threads where id=${id})`
    },
    'contact_identity_conflict',
  ],
  [
    'unowned existing Lead',
    async (db: Database, id: string) => {
      await existingLead(db, id, 'contacted', '')
    },
    'owner_conflict',
  ],
  [
    'different CRM owner',
    async (db: Database, id: string) => {
      await existingLead(db, id, 'contacted', 'Another agent')
    },
    'owner_conflict',
  ],
  [
    'existing New record',
    async (db: Database, id: string) => {
      await existingLead(db, id, 'new')
    },
    'governed_transition_required',
  ],
  [
    'closed record',
    async (db: Database, id: string) => {
      await existingLead(db, id, 'closed_won')
    },
    'existing_record_held',
  ],
] as const)
  withDb(
    `CRM bridge holds ${label} without history, task or lifecycle changes`,
    async (db) => {
      const command = await reviewedCallback(db)
      await change(db, command.payload.threadId)
      const before = await db.sql`select * from leads order by id`
      const result = await executePilotCommand(db.sql, owner, command, now)
      assert.equal(result.state, 'handoff_saved_crm_review')
      assert.deepEqual(await db.sql`select * from leads order by id`, before)
      const [handoff] = await db.sql`select * from em_handoffs`
      assert.equal(handoff.crm_sync_reason, reason)
      assert.equal(handoff.state, 'held')
      assert.equal((await db.sql`select * from work_items`).length, 0)
      assert.equal(
        (await db.sql`select * from em_crm_message_projections`).length,
        0,
      )
    },
  )

withDb(
  'phone-only callback defaults to review instead of becoming a Lead',
  async (db) => {
    const command = await reviewedCallback(db, 'Call me at 816-555-0101.')
    command.payload.positiveSellerInterest = false
    const result = await executePilotCommand(db.sql, owner, command, now)
    assert.equal(result.state, 'handoff_saved_crm_review')
    assert.equal((await db.sql`select * from leads`).length, 0)
    assert.equal((await db.sql`select * from work_items`).length, 0)
    assert.equal(
      (await db.sql`select crm_sync_reason from em_handoffs`)[0]
        .crm_sync_reason,
      'seller_interest_unconfirmed',
    )
  },
)

withDb(
  'missing CRM task dependency retains a held local handoff without partial CRM writes',
  async (db) => {
    const command = await reviewedCallback(db)
    await db.sql.unsafe(
      'drop function public.create_work_item_v2(text,text,uuid,text,text,text,timestamptz,text,text,text,text,boolean,jsonb)',
    )
    const result = await executePilotCommand(db.sql, owner, command, now)
    assert.equal(result.state, 'handoff_saved_crm_dependency_blocked')
    assert.equal((await db.sql`select * from em_handoffs`).length, 1)
    assert.equal((await db.sql`select * from leads`).length, 0)
    assert.equal((await db.sql`select * from lead_activities`).length, 0)
  },
)

withDb(
  'callback projection failure rolls back handoff, Lead, history, notification and receipt',
  async (db) => {
    const command = await reviewedCallback(db)
    await db.sql
      .unsafe(`create function fixture_fail_callback() returns trigger language plpgsql as $$ begin
    if new.activity_type='callback' then raise exception 'fixture callback outage'; end if; return new; end $$;
    create trigger fixture_callback_failure before insert on lead_activities for each row execute function fixture_fail_callback()`)
    await assert.rejects(
      executePilotCommand(db.sql, owner, command, now),
      /fixture callback outage/,
    )
    assert.equal((await db.sql`select * from leads`).length, 0)
    assert.equal((await db.sql`select * from em_handoffs`).length, 0)
    assert.equal(
      (await db.sql`select * from em_crm_handoff_projections`).length,
      0,
    )
    assert.equal((await db.sql`select * from em_attribution_touches`).length, 0)
    assert.equal((await db.sql`select * from lead_activities`).length, 0)
    assert.equal(
      (
        await db.sql`select * from em_command_receipts where idempotency_key=${command.idempotencyKey}`
      ).length,
      0,
    )
    assert.equal(
      (
        await db.sql`select * from em_notifications where kind='Callback task ready'`
      ).length,
      0,
    )
  },
)

withDb(
  'bridge tables deny browser roles and preserve source allowlist and separate profile IDs',
  async (db) => {
    assert.ok(
      (await db.sql`select * from em_memberships`).every(
        (m) => m.auth_user_id !== m.agent_profile_id,
      ),
    )
    await db.sql`insert into leads(source) values('legacy_partner'),('email_marketing')`
    await assert.rejects(
      db.sql`insert into leads(source) values('not_allowed_fixture')`,
      /check constraint/,
    )
    for (const table of [
      'em_crm_handoff_projections',
      'em_crm_message_projections',
      'em_crm_projection_repairs',
      'em_attribution_touches',
    ]) {
      const [priv] =
        await db.sql`select has_table_privilege('authenticated',${table},'select') as browser,
      has_table_privilege('service_role',${table},'insert') as server`
      assert.equal(priv.browser, false)
      assert.equal(priv.server, true)
    }
  },
)

withDb(
  'an earlier uncommitted CRM intake is linked after commit instead of duplicated',
  async (db) => {
    const command = await reviewedCallback(db)
    const [facts] =
      await db.sql`select p.display_name,a.normalized_address as email,cp.*
    from em_threads t join em_parties p on p.id=t.party_id join em_addresses a on a.id=t.address_id
    join em_party_properties ep on ep.party_id=p.id join crm_properties cp on cp.id=ep.canonical_property_id
    where t.id=${command.payload.threadId}`
    let release!: () => void, inserted!: (id: string) => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const ready = new Promise<string>((resolve) => {
      inserted = resolve
    })
    const intake = db.sql.begin(async (tx) => {
      const [lead] =
        await tx`insert into leads(full_name,email,property_address,city,state,zip,source,station,classification,assigned_agent)
      values(${facts.display_name},${facts.email},${facts.address},${facts.city},${facts.state},${facts.zip},
      'legacy_partner','contacted','lead','Demo agent') returning id`
      inserted(lead.id)
      await held
      return lead.id
    })
    const id = await ready
    const bridge = executePilotCommand(db.sql, owner, command, now)
    try {
      for (let n = 0; n < 50; n++) {
        const [locks] =
          await db.sql`select count(*)::int as count from pg_locks where not granted`
        if (locks.count > 0) break
        await new Promise((resolve) => setTimeout(resolve, 10))
      }
    } finally {
      release()
    }
    await intake
    assert.equal((await bridge).state, 'handoff_saved_crm_synced')
    assert.equal((await db.sql`select * from leads`).length, 1)
    assert.equal((await db.sql`select lead_id from em_handoffs`)[0].lead_id, id)
  },
)

withDb(
  'Email identity claim rejects a later duplicate intake and permits a same-record upsert',
  async (db) => {
    const command = await reviewedCallback(db)
    await executePilotCommand(db.sql, owner, command, now)
    const [lead] = await db.sql`select * from leads`
    await assert.rejects(
      db.sql`insert into leads(full_name,email,property_address,city,state,zip,source)
    values(${lead.full_name},${lead.email},${lead.property_address},${lead.city},${lead.state},${lead.zip},'manual')`,
      /EMAIL_CRM_IDENTITY_ALREADY_LINKED/,
    )
    await db.sql`insert into leads(id,full_name,email,property_address,city,state,zip,source)
    values(${lead.id},${lead.full_name},${lead.email},${lead.property_address},${lead.city},${lead.state},${lead.zip},'manual')
    on conflict(id) do update set full_name=excluded.full_name`
    assert.equal((await db.sql`select * from leads`).length, 1)
    assert.equal((await db.sql`select * from em_crm_identity_claims`).length, 1)
  },
)

withDb(
  'after handoff new human messages keep one canonical history and role removal blocks its task',
  async (db) => {
    const command = await reviewedCallback(db)
    await executePilotCommand(db.sql, owner, command, now)
    let current = (await readPilotState(db.sql, agent, now)).threads[0]
    const saved = await executePilotCommand(
      db.sql,
      agent,
      {
        command: 'THR-DRAFT',
        idempotencyKey: randomUUID(),
        payload: {
          threadId: current.id,
          body: 'What time tomorrow works best?',
          contentRevision: current.content_revision,
          controllerRevision: current.controller_revision,
        },
      },
      now,
    )
    await executePilotCommand(
      db.sql,
      agent,
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
    )
    await simulateDelivery(
      db.sql,
      owner,
      randomUUID(),
      new Date(now.getTime() + 2000),
    )
    assert.equal(
      (await db.sql`select * from em_crm_message_projections`).length,
      3,
    )
    const inbound = {
      threadId: current.id,
      eventId: randomUUID(),
      body: 'Please wait until next week.',
    }
    await Promise.all([
      simulateInbound(db.sql, owner, inbound, new Date(now.getTime() + 3000)),
      simulateInbound(db.sql, owner, inbound, new Date(now.getTime() + 3000)),
    ])
    assert.equal(
      (await db.sql`select * from em_crm_message_projections`).length,
      4,
    )
    const settings = (await readPilotState(db.sql, owner, now)).settings!
    const member = settings.members.find((m) => m.id === agent)!
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'SET-ROLES',
        idempotencyKey: randomUUID(),
        expectedRevision: member.revision,
        payload: {
          authUserId: agent,
          roles: ['reader'],
          active: true,
          affectedWorkHash: member.affectedWorkHash,
        },
      },
      now,
    )
    assert.equal(
      (await db.sql`select status from work_items`)[0].status,
      'blocked',
    )
    assert.equal((await db.sql`select * from leads`).length, 1)
    current = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === current.id,
    )!
    assert.equal(current.handoff_state, 'held')
  },
)

test('callback review SLA respects configured weekdays, opening time and Chicago DST', () => {
  assert.equal(
    pilotCallbackDue(new Date('2026-09-12T15:00:00Z')).toISOString(),
    '2026-09-14T13:30:00.000Z',
  )
  assert.equal(
    pilotCallbackDue(new Date('2026-09-14T11:00:00Z')).toISOString(),
    '2026-09-14T13:30:00.000Z',
  )
  assert.equal(
    pilotCallbackDue(new Date('2026-10-30T21:50:00Z')).toISOString(),
    '2026-11-02T14:30:00.000Z',
  )
  assert.equal(
    pilotCallbackDue(now, {
      hours: { weekdays: ['tuesday'], startLocal: '10:00', endLocal: '16:00' },
      sla: { urgentMinutes: 60 },
    }).toISOString(),
    '2026-09-15T15:00:00.000Z',
  )
  assert.equal(
    pilotCallbackDue(new Date('2026-09-14T22:00:00.000Z'), {
      hours: {
        weekdays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        startLocal: '09:00',
        endLocal: '18:00',
      },
      sla: { urgentMinutes: 15 },
    }).toISOString(),
    '2026-09-14T22:15:00.000Z',
  )
})

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
  'confirmed handoff atomically creates a Lead, history, callback and private notification; opt-out blocks the callback',
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
        positiveSellerInterest: true,
        requestedContact: {
          phone: '816-555-0101',
          requestedTimeText: 'tomorrow afternoon',
        },
        factEvidence: [
          { source: 'message', messageId: inbound.entityId, quote: body },
        ],
      },
    }
    const [first, replay] = await Promise.all([
      executePilotCommand(db.sql, owner, command, now),
      executePilotCommand(db.sql, owner, command, now),
    ])
    assert.deepEqual(first, replay)
    const state = await readPilotState(db.sql, agent, now)
    assert.equal(state.threads.length, 1)
    assert.equal(state.threads[0].controller_user_id, agent)
    assert.equal(state.notifications.length, 1)
    assert.equal(
      (await readPilotState(db.sql, reader, now)).notifications.length,
      0,
    )
    const [lead] = await db.sql`select * from leads`
    assert.equal((await db.sql`select * from leads`).length, 1)
    assert.equal(lead.phone, null)
    assert.equal(lead.email, state.threads[0].email)
    assert.equal(lead.station, 'contacted')
    assert.equal(lead.classification, 'lead')
    assert.equal(lead.source, 'email_marketing')
    assert.equal(lead.assigned_agent, 'Demo agent')
    assert.equal(state.threads[0].lead_id, lead.id)
    assert.equal(
      (
        await db.sql`select * from crm_lead_entity_links where lead_id=${lead.id}`
      ).length,
      1,
    )
    assert.equal(
      (await db.sql`select * from em_crm_message_projections`).length,
      2,
    )
    assert.equal((await db.sql`select * from em_attribution_touches`).length, 1)
    const [task] = await db.sql`select * from work_items`
    assert.equal(task.kind, 'callback')
    assert.equal(task.assigned_to, 'Demo agent')
    assert.equal(task.primary_next_action, false)
    assert.equal(task.source_metadata.source, 'governed_workflow')
    assert.equal(task.source_metadata.requested_time_text, 'tomorrow afternoon')
    assert.equal(
      new Date(task.due_at).toISOString(),
      '2026-09-14T15:30:00.000Z',
    )
    assert.equal((await db.sql`select * from work_item_events`).length, 1)
    assert.equal(
      (
        await db.sql`select * from lead_activities where activity_type='appointment'`
      ).length,
      0,
    )
    assert.equal(
      (await db.sql`select crm_sync_state from em_handoffs`)[0].crm_sync_state,
      'synced',
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
    assert.equal(
      (await db.sql`select status from work_items`)[0].status,
      'blocked',
    )
    assert.equal(
      (await db.sql`select * from em_crm_message_projections`).length,
      3,
    )
    assert.equal(
      (await db.sql`select * from work_item_events where action='email_hold'`)
        .length,
      1,
    )
  },
)
withDb(
  'unsubscribe survives damaged CRM history and records one durable repair obligation',
  async (db) => {
    const command = await reviewedCallback(db)
    await executePilotCommand(db.sql, owner, command, now)
    const current = (await readPilotState(db.sql, agent, now)).threads.find(
      (thread) => thread.id === command.payload.threadId,
    )!
    const saved = await executePilotCommand(
      db.sql,
      agent,
      {
        command: 'THR-DRAFT',
        idempotencyKey: randomUUID(),
        payload: {
          threadId: current.id,
          body: 'Would later this afternoon work?',
          contentRevision: current.content_revision,
          controllerRevision: current.controller_revision,
        },
      },
      now,
    )
    const queued = await executePilotCommand(
      db.sql,
      agent,
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
    )
    const [projected] =
      await db.sql`select p.lead_activity_id from em_crm_message_projections p
      where p.thread_id=${current.id} order by p.created_at,p.message_id limit 1`
    assert.ok(projected)
    await db.sql`update lead_activities set description='fixture damaged projected history'
      where id=${projected.lead_activity_id}`

    const inbound = {
      threadId: current.id,
      eventId: randomUUID(),
      body: 'Please unsubscribe me.',
    }
    const first = await simulateInbound(
      db.sql,
      owner,
      inbound,
      new Date(now.getTime() + 2000),
    )
    const replay = await simulateInbound(
      db.sql,
      owner,
      inbound,
      new Date(now.getTime() + 2000),
    )
    assert.deepEqual(replay, first)
    assert.equal(
      (
        await db.sql`select * from em_messages where event_key=${`inbound:${inbound.eventId}`}`
      ).length,
      1,
    )
    assert.equal((await db.sql`select * from em_suppressions`).length, 1)
    const [intent] =
      await db.sql`select state,cancellation_reason from em_send_intents where id=${queued.entityId}`
    assert.equal(intent.state, 'cancelled')
    assert.equal(intent.cancellation_reason, 'inbound_received')
    const [thread] =
      await db.sql`select state,outcome from em_threads where id=${current.id}`
    assert.equal(thread.state, 'stopped')
    assert.equal(thread.outcome, 'unsubscribed')
    assert.equal(
      (
        await db.sql`select * from em_enrollments where id=${current.enrollment_id} and state='suppressed'`
      ).length,
      1,
    )
    const [repair] =
      await db.sql`select * from em_crm_projection_repairs where thread_id=${current.id}`
    assert.equal(repair.state, 'pending')
    assert.equal(repair.history_required, true)
    assert.equal(repair.callback_hold_required, false)
    assert.equal(repair.callback_hold_reason, null)
    assert.equal(repair.last_error_code, 'CRM_MESSAGE_PROJECTION_CONFLICT')
    assert.equal(repair.attempt_count, 1)
    const notices =
      await db.sql`select recipient_id,logical_key from em_notifications
      where kind='CRM repair needed' order by recipient_id`
    assert.deepEqual(
      notices.map((notice) => notice.recipient_id).sort(),
      [owner, agent].sort(),
    )
    assert.ok(
      notices.every(
        (notice) =>
          notice.logical_key === `crm-projection-repair:${current.id}`,
      ),
    )
    assert.equal(
      (await db.sql`select status from work_items`)[0].status,
      'blocked',
    )
    assert.equal(
      (await db.sql`select * from work_item_events where action='email_hold'`)
        .length,
      1,
    )
    assert.equal(
      (await db.sql`select * from em_crm_message_projections`).length,
      2,
    )
    assert.equal((await db.sql`select * from em_messages`).length, 3)
  },
)
withDb(
  'manual stop survives a missing callback projection and owner replay repairs it once',
  async (db) => {
    const command = await reviewedCallback(db)
    await executePilotCommand(db.sql, owner, command, now)
    const [handoff] =
      await db.sql`select crm_task_id,crm_task_key from em_handoffs where thread_id=${command.payload.threadId}`
    assert.ok(handoff.crm_task_id)
    await db.sql`delete from work_items where work_item_key=${handoff.crm_task_key}`

    const [thread] =
      await db.sql`select address_id,enrollment_id from em_threads where id=${command.payload.threadId}`
    const stopped = await executePilotCommand(
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
    assert.equal(stopped.state, 'marketing_stopped')
    assert.equal((await db.sql`select * from em_suppressions`).length, 1)
    assert.equal(
      (
        await db.sql`select * from em_enrollments where id=${thread.enrollment_id} and state='suppressed'`
      ).length,
      1,
    )
    const [repair] =
      await db.sql`select * from em_crm_projection_repairs where thread_id=${command.payload.threadId}`
    assert.equal(repair.state, 'pending')
    assert.equal(repair.history_required, false)
    assert.equal(repair.callback_hold_required, true)
    assert.equal(repair.callback_hold_reason, 'marketing_stopped')
    assert.equal(repair.last_error_code, 'CRM_CALLBACK_SOURCE_MISSING')
    assert.equal(repair.attempt_count, 1)

    for (const subject of [agent, reader])
      await rejects(
        executePilotCommand(
          db.sql,
          subject,
          {
            command: 'OPS-REPLAY',
            idempotencyKey: randomUUID(),
            payload: {
              jobId: repair.id,
              expectedFailureCode: repair.last_error_code,
              reason: 'Fixture projection was restored',
            },
          },
          now,
        ),
        'FORBIDDEN',
      )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'OPS-REPLAY',
          idempotencyKey: randomUUID(),
          payload: {
            jobId: repair.id,
            expectedFailureCode: 'CRM_PROJECTION_FAILED',
            reason: 'Fixture projection was restored',
          },
        },
        now,
      ),
      'CRM_REPAIR_CHANGED',
    )

    await db.sql`update lead_activities set metadata=metadata where id=${handoff.crm_task_id}`
    assert.equal(
      (
        await db.sql`select * from work_items where source_kind='activity' and source_id=${handoff.crm_task_id}`
      ).length,
      1,
    )
    const replayCommand = {
      command: 'OPS-REPLAY',
      idempotencyKey: randomUUID(),
      payload: {
        jobId: repair.id,
        expectedFailureCode: repair.last_error_code,
        reason: 'Fixture projection was restored',
      },
    }
    const [first, replay] = await Promise.all([
      executePilotCommand(db.sql, owner, replayCommand, now),
      executePilotCommand(db.sql, owner, replayCommand, now),
    ])
    assert.deepEqual(replay, first)
    assert.equal(first.state, 'crm_repair_resolved')
    const [resolved] =
      await db.sql`select * from em_crm_projection_repairs where id=${repair.id}`
    assert.equal(resolved.state, 'resolved')
    assert.equal(resolved.history_required, false)
    assert.equal(resolved.callback_hold_required, false)
    assert.equal(resolved.callback_hold_reason, null)
    assert.equal(resolved.attempt_count, 2)
    assert.ok(resolved.resolved_at)
    const repairNotices =
      await db.sql`select kind from em_notifications where logical_key=${`crm-projection-repair:${command.payload.threadId}`}`
    assert.equal(repairNotices.length, 2)
    assert.ok(
      repairNotices.every((notice) => notice.kind === 'CRM repair resolved'),
    )
    assert.equal(
      (
        await db.sql`select * from lead_activities where activity_type='callback' and id=${handoff.crm_task_id}`
      ).length,
      1,
    )
    const [workItem] =
      await db.sql`select * from work_items where source_kind='activity' and source_id=${handoff.crm_task_id}`
    assert.equal(workItem.status, 'blocked')
    assert.equal(
      (await db.sql`select * from work_item_events where action='create'`)
        .length,
      1,
    )
    assert.equal(
      (await db.sql`select * from work_item_events where action='email_hold'`)
        .length,
      1,
    )
    assert.equal(
      (
        await db.sql`select * from em_audit_events where action='CRM-REPAIR-ATTEMPT'`
      ).length,
      1,
    )
    assert.equal(
      (
        await db.sql`select * from em_command_receipts where command='OPS-REPLAY'`
      ).length,
      1,
    )
    const [counts] = await db.sql`select
      (select count(*)::int from em_messages) as messages,
      (select count(*)::int from em_crm_message_projections) as projections,
      (select count(*)::int from lead_activities where activity_type='email') as history`
    assert.equal(counts.projections, counts.messages)
    assert.equal(counts.history, counts.messages)
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
    const current = (await readPilotState(db.sql, owner, now)).threads.find(
      (candidate) => candidate.id === thread.id,
    )!
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          ...command,
          expectedRevision: current.content_revision,
          idempotencyKey: randomUUID(),
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
    await db.sql`delete from agent_profiles where id=(select agent_profile_id from em_memberships where auth_user_id=${agent})`
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
    await db.sql`delete from agent_profiles where id=(select agent_profile_id from em_memberships where auth_user_id=${agent})`
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

withDb(
  'Calendar lists only open work for the linked Lead in due order',
  async (db) => {
    const command = await reviewedCallback(db)
    command.payload.ownerId = owner
    command.payload.backupId = agent
    await executePilotCommand(db.sql, owner, command, now)
    const [thread] =
      await db.sql`select lead_id from em_threads where id=${command.payload.threadId}`
    const create = async (
      title: string,
      kind: string,
      due: string | null,
      lead: string | null = thread.lead_id,
    ) => {
      const [row] =
        await db.sql`select create_work_item_v2(${owner},${randomUUID()},${lead}::uuid,${kind},${title},'Saved task context',${due}::timestamptz,'Demo agent','acquisitions',null,'normal',false,'{}'::jsonb) as result`
      return row.result.workItem
    }
    const overdue = await create(
      'Overdue callback',
      'callback',
      '2026-09-14T14:00:00Z',
    )
    const appointment = await create(
      'Property walkthrough',
      'appointment',
      '2026-09-15T20:00:00Z',
    )
    const undated = await create('Research property', 'task', null)
    const completed = await create(
      'Finished research',
      'task',
      '2026-09-14T13:00:00Z',
    )
    await db.sql`update lead_activities set metadata=metadata || '{"status":"completed"}'::jsonb where id=${completed.source_id}`
    await db.sql`update lead_activities set metadata=metadata || '{"status":"blocked"}'::jsonb where id=${overdue.source_id}`
    await create(
      'Unlinked task must stay out',
      'follow_up',
      '2026-09-14T12:00:00Z',
      null,
    )
    const state = await readPilotState(db.sql, owner, now)
    const current = state.threads.find(
      (t) => t.id === command.payload.threadId,
    )!
    assert.equal(current.open_task_count, 4)
    assert.equal(current.open_tasks?.length, 4)
    assert.equal(current.open_tasks?.[0].key, overdue.work_item_key)
    assert.equal(current.open_tasks?.[0].status, 'blocked')
    assert.equal(current.open_tasks?.at(-1)?.key, undated.work_item_key)
    assert.equal(
      current.open_tasks?.find((t) => t.key === appointment.work_item_key)
        ?.assigned_to,
      'Demo agent',
    )
    assert.equal(
      current.open_tasks?.find((t) => t.key === appointment.work_item_key)
        ?.notes,
      'Saved task context',
    )
    assert.equal(
      current.open_tasks?.some((t) => t.key === completed.work_item_key),
      false,
    )
    for (const other of state.threads.filter((t) => t.id !== current.id))
      assert.equal(other.open_tasks?.length, 0)
  },
)

withDb(
  'handoff reassignment atomically updates canonical owner, callback and private acceptance notice',
  async (db) => {
    const initial = await reviewedCallback(db)
    const handoff = await executePilotCommand(db.sql, owner, initial, now)
    const t = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    const command = {
      command: 'HAN-REASSIGN',
      idempotencyKey: randomUUID(),
      expectedRevision: t.handoff_revision,
      payload: {
        handoffId: handoff.entityId,
        newOwnerId: owner,
        backupId: agent,
        reason: 'Owner covering this callback',
        expectedCrmOwner: 'Demo agent',
        contentRevision: t.content_revision,
        controllerRevision: t.controller_revision,
      },
    }
    await rejects(
      executePilotCommand(db.sql, reader, command, now),
      'FORBIDDEN',
    )
    const result = await executePilotCommand(db.sql, owner, command, now)
    assert.deepEqual(
      await executePilotCommand(db.sql, owner, command, now),
      result,
    )
    assert.equal(result.state, 'callback_reassigned')
    const current = (await readPilotState(db.sql, owner, now)).threads.find(
      (x) => x.id === t.id,
    )!
    assert.equal(current.crm_owner_name, 'Demo owner')
    assert.equal(current.handoff_owner_id, owner)
    assert.equal(current.controller_user_id, owner)
    assert.equal(current.callback_owner_changed, false)
    assert.equal(current.open_tasks![0].assigned_to, 'Demo owner')
    assert.equal(current.handoff_state, 'needs_contact')
    assert.equal((await db.sql`select * from work_items`).length, 1)
    assert.equal((await db.sql`select * from leads`).length, 1)
    const oldNotices =
      await db.sql`select * from em_notifications where recipient_id=${agent}`
    assert.ok(oldNotices.every((n) => n.acknowledged_at))
    assert.equal(
      (await readPilotState(db.sql, owner, now)).notifications.filter(
        (n) => !n.acknowledged_at && n.kind.startsWith('Callback'),
      ).length,
      1,
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        { ...command, idempotencyKey: randomUUID() },
        now,
      ),
      'HANDOFF_CHANGED',
    )
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'HAN-ACCEPT',
        idempotencyKey: randomUUID(),
        expectedRevision: 1,
        payload: { handoffId: handoff.entityId },
      },
      now,
    )
    assert.equal(
      (await readPilotState(db.sql, owner, now)).notifications.filter(
        (n) => !n.acknowledged_at && n.kind.startsWith('Callback'),
      ).length,
      0,
    )
  },
)

withDb(
  'external CRM owner change is visible and cannot be overwritten with stale assignment evidence',
  async (db) => {
    const initial = await reviewedCallback(db)
    const handoff = await executePilotCommand(db.sql, owner, initial, now)
    const t = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    await db.sql`update leads set assigned_agent='Demo owner' where id=${t.lead_id}`
    const changed = (await readPilotState(db.sql, owner, now)).threads.find(
      (x) => x.id === t.id,
    )!
    assert.equal(changed.callback_owner_changed, true)
    await rejects(
      executePilotCommand(
        db.sql,
        agent,
        {
          command: 'HAN-ACCEPT',
          idempotencyKey: randomUUID(),
          expectedRevision: 0,
          payload: { handoffId: handoff.entityId },
        },
        now,
      ),
      'CALLBACK_OWNER_CHANGED',
    )
    const command = {
      command: 'HAN-REASSIGN',
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      payload: {
        handoffId: handoff.entityId,
        newOwnerId: owner,
        backupId: agent,
        reason: 'Match current CRM owner',
        expectedCrmOwner: 'Demo agent',
        contentRevision: t.content_revision,
        controllerRevision: t.controller_revision,
      },
    }
    await rejects(
      executePilotCommand(db.sql, owner, command, now),
      'CALLBACK_OWNER_CHANGED',
    )
    command.payload.expectedCrmOwner = 'Demo owner'
    await executePilotCommand(db.sql, owner, command, now)
    assert.equal(
      (await db.sql`select assigned_to from work_items`)[0].assigned_to,
      'Demo owner',
    )
  },
)

withDb(
  'held handoff can be freshly reviewed and linked once while preserving old review evidence',
  async (db) => {
    const initial = await reviewedCallback(db)
    initial.payload.positiveSellerInterest = false
    const held = await executePilotCommand(db.sql, owner, initial, now)
    assert.equal(held.state, 'handoff_saved_crm_review')
    const t = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    const command = {
      command: 'HAN-RESOLVE',
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      payload: {
        handoffId: held.entityId,
        ownerId: agent,
        backupId: owner,
        reason: 'Confirmed seller interest in latest reply',
        positiveSellerInterest: true,
        requestedContact: {},
        factEvidence: initial.payload.factEvidence,
        contentRevision: t.content_revision,
        controllerRevision: t.controller_revision,
      },
    }
    await rejects(
      executePilotCommand(db.sql, reader, command, now),
      'FORBIDDEN',
    )
    const result = await executePilotCommand(db.sql, owner, command, now)
    assert.equal(result.state, 'handoff_saved_crm_synced')
    assert.deepEqual(
      await executePilotCommand(db.sql, owner, command, now),
      result,
    )
    assert.equal((await db.sql`select * from em_handoffs`).length, 1)
    assert.equal((await db.sql`select * from work_items`).length, 1)
    assert.equal((await db.sql`select * from leads`).length, 1)
    const audit = (
      await db.sql`select detail from em_audit_events where action='HAN-RESOLVE-REVIEW'`
    )[0]
    assert.equal(audit.detail.previous.positiveSellerInterest, false)
    assert.equal(audit.detail.next.positiveSellerInterest, true)
    assert.equal(
      (await readPilotState(db.sql, agent, now)).threads.find(
        (x) => x.id === t.id,
      )!.handoff_state,
      'needs_contact',
    )
  },
)

withDb(
  'held handoff resolution rejects old inbound evidence and forged contact details',
  async (db) => {
    const initial = await reviewedCallback(db)
    initial.payload.positiveSellerInterest = false
    const held = await executePilotCommand(db.sql, owner, initial, now)
    const t = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    const base = {
      command: 'HAN-RESOLVE',
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      payload: {
        handoffId: held.entityId,
        ownerId: agent,
        backupId: owner,
        reason: 'Reviewing again',
        positiveSellerInterest: true,
        requestedContact: { phone: '8165559999' },
        factEvidence: initial.payload.factEvidence,
        contentRevision: t.content_revision,
        controllerRevision: t.controller_revision,
      },
    }
    await rejects(
      executePilotCommand(db.sql, owner, base, now),
      'PHONE_EVIDENCE_REQUIRED',
    )
    await simulateInbound(
      db.sql,
      owner,
      {
        threadId: t.id,
        eventId: randomUUID(),
        body: 'Please wait until next month.',
      },
      new Date(now.getTime() + 5000),
    )
    const fresh = (await readPilotState(db.sql, owner, now)).threads.find(
      (x) => x.id === t.id,
    )!
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          ...base,
          payload: { ...base.payload, contentRevision: fresh.content_revision },
        },
        now,
      ),
      'NEW_REPLY_REVIEW_REQUIRED',
    )
    assert.equal((await db.sql`select * from leads`).length, 0)
    assert.equal(
      (
        await db.sql`select * from em_audit_events where action='HAN-RESOLVE-REVIEW'`
      ).length,
      0,
    )
  },
)

withDb(
  'reassignment rolls back canonical owner and notification when callback projection fails',
  async (db) => {
    const initial = await reviewedCallback(db)
    const handoff = await executePilotCommand(db.sql, owner, initial, now)
    const t = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    await db.sql
      .unsafe(`create function reject_callback_change() returns trigger language plpgsql as $$ begin raise exception 'fixture projection failure'; end $$;
    create trigger fixture_reject before update on work_items for each row execute function reject_callback_change()`)
    await assert.rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          command: 'HAN-REASSIGN',
          idempotencyKey: randomUUID(),
          expectedRevision: 0,
          payload: {
            handoffId: handoff.entityId,
            newOwnerId: owner,
            backupId: agent,
            reason: 'Coverage',
            expectedCrmOwner: 'Demo agent',
            contentRevision: t.content_revision,
            controllerRevision: t.controller_revision,
          },
        },
        now,
      ),
    )
    assert.equal(
      (await db.sql`select assigned_agent from leads`)[0].assigned_agent,
      'Demo agent',
    )
    assert.equal(
      (await db.sql`select owner_id from em_handoffs`)[0].owner_id,
      agent,
    )
    assert.equal((await db.sql`select * from em_notifications`).length, 2)
  },
)

withDb(
  'call outcomes require a dated next action and never change Lead qualification',
  async (db) => {
    const initial = await reviewedCallback(db)
    const handoff = await executePilotCommand(db.sql, owner, initial, now)
    const t = (await readPilotState(db.sql, agent, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    const base = {
      command: 'HAN-OUTCOME',
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      payload: {
        handoffId: handoff.entityId,
        outcome: 'no_contact',
        note: 'No answer. Try tomorrow afternoon.',
        contentRevision: t.content_revision,
      },
    }
    await rejects(
      executePilotCommand(db.sql, agent, base, now),
      'NEXT_ACTION_REQUIRED',
    )
    const next = {
      ...base,
      payload: {
        ...base.payload,
        nextAction: 'Try the seller again',
        nextDueAt: '2026-09-15T19:00:00Z',
      },
    }
    const result = await executePilotCommand(db.sql, agent, next, now)
    assert.equal(result.state, 'callback_scheduled')
    assert.deepEqual(
      await executePilotCommand(db.sql, agent, next, now),
      result,
    )
    const [item] = await db.sql`select * from work_items`
    assert.equal(item.status, 'pending')
    assert.equal(item.title, 'Try the seller again')
    assert.equal(item.source_metadata.email_outcome, 'no_contact')
    assert.equal(
      (await db.sql`select * from lead_activities where activity_type='note'`)
        .length,
      1,
    )
    await executePilotCommand(
      db.sql,
      agent,
      {
        ...base,
        idempotencyKey: randomUUID(),
        expectedRevision: 1,
        payload: {
          ...base.payload,
          outcome: 'not_qualified',
          note: 'Seller decided to keep the property.',
        },
      },
      now,
    )
    const [lead] = await db.sql`select * from leads`
    assert.equal(lead.station, 'contacted')
    assert.equal(lead.classification, 'lead')
    assert.equal(
      (await db.sql`select status from work_items`)[0].status,
      'completed',
    )
    assert.equal(
      (await db.sql`select state from em_threads where id=${t.id}`)[0].state,
      'done',
    )
    assert.equal(
      (await db.sql`select * from lead_activities where activity_type='note'`)
        .length,
      2,
    )
  },
)

withDb(
  'live CRM inactive and mismatched profiles cannot read, act or receive new handoffs',
  async (db) => {
    const command = await reviewedCallback(db)
    await db.sql`update agent_profiles set is_active=false where email='agent@savingkc.test'`
    await rejects(readPilotState(db.sql, agent, now), 'NO_EMAIL_MEMBERSHIP')
    await rejects(
      executePilotCommand(db.sql, owner, command, now),
      'ASSIGNEE_UNAVAILABLE',
    )
    assert.equal(
      (await readPilotState(db.sql, owner, now)).members.some(
        (m) => m.id === agent,
      ),
      false,
    )
    await db.sql`update agent_profiles set is_active=true,user_id=${reader} where email='agent@savingkc.test'`
    await rejects(readPilotState(db.sql, agent, now), 'NO_EMAIL_MEMBERSHIP')
    await rejects(
      executePilotCommand(db.sql, owner, command, now),
      'ASSIGNEE_UNAVAILABLE',
    )
    await db.sql`update agent_profiles set user_id=${agent} where email='agent@savingkc.test'`
    const result = await executePilotCommand(db.sql, owner, command, now)
    assert.equal(result.state, 'handoff_saved_crm_synced')
    await db.sql`update agent_profiles set is_active=false where email='agent@savingkc.test'`
    const state = await readPilotState(db.sql, owner, now)
    assert.equal(
      state.threads.find((t) => t.id === command.payload.threadId)!
        .callback_owner_changed,
      true,
    )
    assert.equal(
      state.settings!.members.find((m) => m.id === agent)!.crm_active,
      false,
    )
  },
)

withDb(
  'Ari stores one generation for concurrent retries and never queues a message itself',
  async (db) => {
    const initial = await reviewedCallback(db)
    const t = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    const command = {
      command: 'THR-REGENERATE',
      idempotencyKey: randomUUID(),
      payload: {
        threadId: t.id,
        contentRevision: t.content_revision,
        controllerRevision: t.controller_revision,
      },
    }
    let calls = 0
    const provider = {
      model: 'fixture-only',
      async generate(input: {
        messages: { id: string; direction: string; body: string }[]
      }) {
        calls++
        const latest = input.messages
          .filter((m) => m.direction === 'inbound')
          .at(-1)!
        return {
          output: {
            decision: 'reply',
            body: 'What time would work for a quick call?',
            summary: 'The seller asked to talk.',
            reason: 'Clarify a call time.',
            evidence: [{ messageId: latest.id, quote: latest.body }],
          },
          inputTokens: 300,
          outputTokens: 100,
        }
      },
    }
    await rejects(
      executePilotCommand(db.sql, reader, command, now, provider),
      'FORBIDDEN',
    )
    const results = await Promise.all([
      executePilotCommand(db.sql, owner, command, now, provider),
      executePilotCommand(db.sql, owner, command, now, provider),
    ])
    assert.equal(calls, 1)
    assert.equal(results[0].entityId, results[1].entityId)
    const final = await executePilotCommand(
      db.sql,
      owner,
      command,
      now,
      provider,
    )
    assert.equal(final.state, 'ai_ready')
    assert.equal(calls, 1)
    const [generation] = await db.sql`select * from em_ai_generations`
    assert.equal(generation.state, 'ready')
    assert.equal(generation.input_tokens, 300)
    assert.equal(
      generation.output.body,
      'What time would work for a quick call?',
    )
    assert.equal(
      (await db.sql`select * from em_send_intents where origin='human'`).length,
      0,
    )
    assert.equal(
      (await readPilotState(db.sql, owner, now)).threads.find(
        (x) => x.id === t.id,
      )!.ai_generation!.id,
      generation.id,
    )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          ...command,
          idempotencyKey: randomUUID(),
          payload: { ...command.payload, contentRevision: 0 },
        },
        now,
        provider,
      ),
      'NEW_REPLY_REVIEW_REQUIRED',
    )
    const http = createWorkflowHttp({
      subject: async () => reader,
      database: () => db.sql,
      now: () => now,
    })
    const response = await http.GET(
      new Request(
        `http://localhost/api/email/workspace?generation=${generation.id}`,
      ),
    )
    assert.equal(response.status, 404)
  },
)

withDb(
  'new inbound during Ari inference preserves stale output and blocks approval',
  async (db) => {
    const initial = await reviewedCallback(db)
    const t = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    let started!: () => void, finish!: () => void
    const entered = new Promise<void>((r) => (started = r)),
      hold = new Promise<void>((r) => (finish = r))
    const pending = executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-REGENERATE',
        idempotencyKey: randomUUID(),
        payload: {
          threadId: t.id,
          contentRevision: t.content_revision,
          controllerRevision: t.controller_revision,
        },
      },
      now,
      {
        model: 'fixture-only',
        async generate(input) {
          started()
          await hold
          const m = input.messages.at(-1)!
          return {
            output: {
              decision: 'reply',
              body: 'What time works for a call?',
              summary: 'Call requested.',
              reason: 'Confirm time.',
              evidence: [{ messageId: m.id, quote: m.body }],
            },
          }
        },
      },
    )
    await entered
    await simulateInbound(
      db.sql,
      owner,
      {
        threadId: t.id,
        eventId: randomUUID(),
        body: 'Please stop emailing me.',
      },
      new Date(now.getTime() + 1000),
    )
    finish()
    const result = await pending
    assert.equal(result.state, 'ai_stale')
    const [generation] = await db.sql`select * from em_ai_generations`
    assert.equal(generation.state, 'stale')
    assert.ok(generation.output.body)
    assert.equal(generation.estimated_cost_usd, null)
    assert.equal(
      (await db.sql`select * from em_send_intents where origin='human'`).length,
      0,
    )
  },
)

withDb(
  'Ari failure persists unknown usage and request replay cannot repeat a charge',
  async (db) => {
    const initial = await reviewedCallback(db)
    const t = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    const command = {
      command: 'THR-REGENERATE',
      idempotencyKey: randomUUID(),
      payload: {
        threadId: t.id,
        contentRevision: t.content_revision,
        controllerRevision: t.controller_revision,
      },
    }
    let calls = 0
    const provider = {
      model: 'fixture-only',
      async generate() {
        calls++
        throw Error('private provider credential must not be retained')
      },
    }
    assert.equal(
      (await executePilotCommand(db.sql, owner, command, now, provider)).state,
      'ai_failed',
    )
    assert.equal(
      (await executePilotCommand(db.sql, owner, command, now, provider)).state,
      'ai_failed',
    )
    assert.equal(calls, 1)
    const [g] = await db.sql`select * from em_ai_generations`
    assert.equal(g.failure_code, 'AI_GENERATION_FAILED')
    assert.equal(g.estimated_cost_usd, null)
    assert.equal(Number(g.reserved_cost_usd), 0.02)
  },
)

withDb(
  'Ari requires a connection, current authority and shared hourly allowance',
  async (db) => {
    const initial = await reviewedCallback(db)
    const t = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    const command = {
      command: 'THR-REGENERATE',
      idempotencyKey: randomUUID(),
      payload: {
        threadId: t.id,
        contentRevision: t.content_revision,
        controllerRevision: t.controller_revision,
      },
    }
    await rejects(
      executePilotCommand(db.sql, owner, command, now, null),
      'AI_NOT_CONNECTED',
    )
    let calls = 0
    const provider = {
      model: 'fixture-only',
      async generate() {
        calls++
        return {
          output: {
            decision: 'review',
            body: '',
            summary: 'Review needed.',
            reason: 'Human judgment required.',
            evidence: [],
          },
        }
      },
    }
    for (let i = 0; i < 10; i++)
      await executePilotCommand(
        db.sql,
        owner,
        {
          ...command,
          idempotencyKey: randomUUID(),
          payload: { ...command.payload, instruction: `Review variation ${i}` },
        },
        now,
        provider,
      )
    await rejects(
      executePilotCommand(
        db.sql,
        owner,
        {
          ...command,
          idempotencyKey: randomUUID(),
          payload: { ...command.payload, instruction: 'One too many' },
        },
        now,
        provider,
      ),
      'AI_BUDGET_REACHED',
    )
    assert.equal(calls, 10)
    assert.equal((await db.sql`select * from em_ai_generations`).length, 10)
  },
)

withDb(
  'service connection checks once, encrypts credentials and returns masked owner-only results',
  async (db) => {
    const { connectService, readConnections } = await import(
      '../../src/lib/email/connections/service'
    )
    const { decryptEmailSecret } = await import('../../src/lib/email/secrets')
    const key = Buffer.alloc(32, 7),
      secret = 're_fixture_private_resend_key_123456789'
    const [{ revision }] =
      await db.sql`select revision from em_workspaces limit 1`
    const request = {
      kind: 'email',
      provider: 'resend',
      secret,
      expectedRevision: revision,
      accountLabel: 'Fixture account',
      idempotencyKey: randomUUID(),
    }
    let calls = 0,
      release!: () => void,
      started!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
      }),
      began = new Promise<void>((resolve) => {
        started = resolve
      })
    const checker = async () => {
      calls++
      started()
      await gate
      return {
        domainsRead: true,
        receivingRead: true,
        sendingVerified: false as const,
      }
    }
    const pending = connectService(db.sql, owner, request, checker, key, now)
    await began
    const replay = await connectService(
      db.sql,
      owner,
      request,
      checker,
      key,
      now,
    )
    assert.equal(replay.connections[0].state, 'checking')
    release()
    const result = await pending
    assert.equal(calls, 1)
    assert.equal(result.connections[0].state, 'checked')
    assert.equal(JSON.stringify(result).includes(secret), false)
    const [saved] = await db.sql`select * from em_service_connections`
    assert.equal(
      decryptEmailSecret(
        saved.encrypted_secret,
        key,
        `${saved.workspace_id}/${saved.id}/resend/1`,
      ),
      secret,
    )
    assert.equal(
      JSON.stringify(await db.sql`select * from em_audit_events`).includes(
        secret,
      ),
      false,
    )
    assert.equal(
      JSON.stringify(await db.sql`select * from em_command_receipts`).includes(
        secret,
      ),
      false,
    )
    await rejects(readConnections(db.sql, reader, key), 'FORBIDDEN')
    await rejects(
      connectService(
        db.sql,
        reader,
        { ...request, idempotencyKey: randomUUID() },
        checker,
        key,
        now,
      ),
      'FORBIDDEN',
    )
    await rejects(
      connectService(
        db.sql,
        owner,
        { ...request, secret: 're_different_private_resend_123456' },
        checker,
        key,
        now,
      ),
      'IDEMPOTENCY_MISMATCH',
    )
    const [ws] =
      await db.sql`select send_enabled,ai_auto_enabled from em_workspaces limit 1`
    assert.equal(ws.send_enabled, false)
    assert.equal(ws.ai_auto_enabled, false)
  },
)

withDb(
  'failed service replacement preserves a checked connection and never stores raw errors',
  async (db) => {
    const { connectService } = await import(
      '../../src/lib/email/connections/service'
    )
    const key = Buffer.alloc(32, 8),
      secret = 're_fixture_secret_one_123456'
    const [{ revision }] =
      await db.sql`select revision from em_workspaces limit 1`
    const request = {
      kind: 'email',
      provider: 'resend',
      secret,
      expectedRevision: revision,
      accountLabel: 'First fixture',
      idempotencyKey: randomUUID(),
    }
    const checker = async () => ({
      domainsRead: true,
      receivingRead: true,
      sendingVerified: false as const,
    })
    const good = await connectService(db.sql, owner, request, checker, key, now)
    const failed = await connectService(
      db.sql,
      owner,
      {
        ...request,
        secret: 're_fixture_secret_two_987654',
        idempotencyKey: randomUUID(),
      },
      async () => {
        throw Error('private provider error ' + secret)
      },
      key,
      now,
    )
    const rows =
      await db.sql`select id,state,encrypted_secret,failure_code from em_service_connections`
    assert.equal(rows.find((r) => r.id === good.connectionId)?.state, 'checked')
    assert.ok(rows.find((r) => r.id === good.connectionId)?.encrypted_secret)
    assert.equal(
      rows.find((r) => r.id === failed.connectionId)?.encrypted_secret,
      null,
    )
    assert.equal(
      rows.find((r) => r.id === failed.connectionId)?.failure_code,
      'SERVICE_CHECK_FAILED',
    )
    assert.equal(JSON.stringify(failed).includes(secret), false)
    await rejects(
      connectService(
        db.sql,
        owner,
        { ...request, idempotencyKey: randomUUID() },
        checker,
        null,
        now,
      ),
      'CREDENTIAL_STORAGE_REQUIRED',
    )
  },
)

withDb(
  'service validation loses authority when the CRM owner profile becomes inactive',
  async (db) => {
    const { connectService } = await import(
      '../../src/lib/email/connections/service'
    )
    const [{ revision }] =
      await db.sql`select revision from em_workspaces limit 1`
    const request = {
      kind: 'email',
      provider: 'resend',
      secret: 're_fixture_key_private_123456',
      expectedRevision: revision,
      accountLabel: 'Fixture',
      idempotencyKey: randomUUID(),
    }
    await rejects(
      connectService(
        db.sql,
        owner,
        request,
        async () => {
          await db.sql`update agent_profiles set is_active=false where id=(select agent_profile_id from em_memberships where auth_user_id=${owner})`
          return {
            domainsRead: true,
            receivingRead: true,
            sendingVerified: false as const,
          }
        },
        Buffer.alloc(32, 9),
        now,
      ),
      'FORBIDDEN',
    )
    const [saved] =
      await db.sql`select state,failure_code,encrypted_secret from em_service_connections`
    assert.equal(saved.state, 'failed')
    assert.equal(saved.failure_code, 'SERVICE_REVIEW_CHANGED')
    assert.equal(saved.encrypted_secret, null)
  },
)

withDb(
  'credential endpoint rejects cross-origin and unauthenticated requests before storage',
  async (db) => {
    const { createConnectionHttp } = await import(
      '../../src/lib/email/connections/http'
    )
    const handlers = createConnectionHttp({
      subject: async () => owner,
      database: () => db.sql,
    })
    const cross = await handlers.POST(
      new Request('https://crm.test/api/email/connections', {
        method: 'POST',
        headers: {
          origin: 'https://attacker.test',
          'content-type': 'application/json',
        },
        body: '{}',
      }),
    )
    assert.equal(cross.status, 403)
    const anonymous = createConnectionHttp({
      subject: async () => null,
      database: () => {
        throw Error('must not query')
      },
    })
    assert.equal(
      (
        await anonymous.GET(
          new Request('https://crm.test/api/email/connections'),
        )
      ).status,
      401,
    )
    assert.equal((await db.sql`select * from em_service_connections`).length, 0)
  },
)

withDb(
  'disconnect rejects stale impact, clears the key, pauses work and safely replays',
  async (db) => {
    const { connectService, disconnectService } = await import(
      '../../src/lib/email/connections/service'
    )
    const [{ revision }] =
      await db.sql`select revision from em_workspaces limit 1`
    const connected = await connectService(
      db.sql,
      owner,
      {
        kind: 'email',
        provider: 'resend',
        secret: 're_fixture_disconnect_key_123456',
        expectedRevision: revision,
        accountLabel: 'Fixture',
        idempotencyKey: randomUUID(),
      },
      async () => ({
        domainsRead: true,
        receivingRead: true,
        sendingVerified: false as const,
      }),
      Buffer.alloc(32, 3),
      now,
    )
    const command = {
      connectionId: connected.connectionId,
      expectedRevision: connected.revision,
      confirmedAffectedHash: connected.disconnectImpact.hash,
      reason: 'Test disconnect',
      idempotencyKey: randomUUID(),
    }
    await rejects(
      disconnectService(db.sql, owner, {
        ...command,
        confirmedAffectedHash: '0'.repeat(64),
      }),
      'CONNECTION_IMPACT_CHANGED',
    )
    await rejects(disconnectService(db.sql, reader, command), 'FORBIDDEN')
    await disconnectService(db.sql, owner, command)
    await disconnectService(db.sql, owner, command)
    const [saved] =
      await db.sql`select state,encrypted_secret from em_service_connections`
    assert.equal(saved.state, 'revoked')
    assert.equal(saved.encrypted_secret, null)
    const [ws] =
      await db.sql`select pause_reason,send_enabled,ai_auto_enabled,revision from em_workspaces limit 1`
    assert.equal(ws.pause_reason, 'Provider connection disconnected')
    assert.equal(ws.send_enabled, false)
    assert.equal(ws.ai_auto_enabled, false)
    assert.equal(ws.revision, revision + 1)
    assert.equal(
      (
        await db.sql`select id from em_audit_events where action='SVC-DISCONNECT'`
      ).length,
      1,
    )
  },
)

withDb(
  'disconnect during capability check cannot restore a revoked key',
  async (db) => {
    const { connectService, readConnections, disconnectService } = await import(
      '../../src/lib/email/connections/service'
    )
    const key = Buffer.alloc(32, 4)
    const [{ revision }] =
      await db.sql`select revision from em_workspaces limit 1`
    let release!: () => void, started!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
      }),
      began = new Promise<void>((resolve) => {
        started = resolve
      })
    const pending = connectService(
      db.sql,
      owner,
      {
        kind: 'email',
        provider: 'resend',
        secret: 're_fixture_revocation_key_123456',
        expectedRevision: revision,
        accountLabel: 'Fixture',
        idempotencyKey: randomUUID(),
      },
      async () => {
        started()
        await gate
        return {
          domainsRead: true,
          receivingRead: true,
          sendingVerified: false as const,
        }
      },
      key,
      now,
    )
    await began
    const snapshot = await readConnections(db.sql, owner, key)
    await disconnectService(db.sql, owner, {
      connectionId: snapshot.connections[0].id,
      expectedRevision: snapshot.revision,
      confirmedAffectedHash: snapshot.disconnectImpact.hash,
      reason: 'Cancel pending setup',
      idempotencyKey: randomUUID(),
    })
    release()
    await pending
    const [saved] =
      await db.sql`select state,encrypted_secret from em_service_connections`
    assert.equal(saved.state, 'revoked')
    assert.equal(saved.encrypted_secret, null)
    assert.equal(
      (
        await db.sql`select id from em_audit_events where action='SVC-CHECK' and detail->>'state'='checked'`
      ).length,
      0,
    )
  },
)

async function domainFixture(db: Database) {
  const { connectService } = await import(
    '../../src/lib/email/connections/service'
  )
  const key = Buffer.alloc(32, 6)
  let [{ revision }] = await db.sql`select revision from em_workspaces limit 1`
  await executePilotCommand(
    db.sql,
    owner,
    {
      command: 'SET-BUSINESS',
      idempotencyKey: randomUUID(),
      expectedRevision: revision,
      payload: {
        name: 'Fixture company',
        address: '123 Test Street',
        primaryDomain: 'savingkc.com',
        timezone: 'America/Chicago',
        programs: ['seller_outreach'],
        contact: 'Fixture contact',
        privacyUrl: 'https://savingkc.com/privacy',
      },
    },
    now,
  )
  ;[{ revision }] = await db.sql`select revision from em_workspaces limit 1`
  const connected = await connectService(
    db.sql,
    owner,
    {
      kind: 'email',
      provider: 'resend',
      secret: 're_fixture_domain_key_123456789',
      expectedRevision: revision,
      accountLabel: 'Domain fixture',
      idempotencyKey: randomUUID(),
    },
    async () => ({
      domainsRead: true,
      receivingRead: true,
      sendingVerified: false as const,
    }),
    key,
    now,
  )
  const domain = {
    id: randomUUID(),
    name: 'savingkc-outreach.com',
    status: 'not_started',
    capabilities: { sending: 'enabled', receiving: 'enabled' },
    records: [
      {
        record: 'DKIM',
        name: 'resend._domainkey',
        type: 'TXT',
        value: 'fixture-provider-dkim',
        status: 'not_started',
      },
    ],
  }
  const provider = {
    create: async () => domain,
    find: async () => domain,
    get: async () => domain,
  }
  const command = {
    command: 'DOM-ADD',
    idempotencyKey: randomUUID(),
    expectedRevision: revision,
    payload: {
      domain: domain.name,
      connectionId: connected.connectionId,
      brandUrl: 'https://savingkc-outreach.com',
    },
  }
  return { key, connected, domain, provider, command }
}

withDb(
  'domain setup rejects the primary domain and deduplicates creation across request keys',
  async (db) => {
    const { executeDomainCommand } = await import(
      '../../src/lib/email/domains/service'
    )
    const f = await domainFixture(db)
    let creates = 0,
      release!: () => void,
      started!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
      }),
      began = new Promise<void>((resolve) => {
        started = resolve
      })
    const provider = {
      ...f.provider,
      create: async () => {
        creates++
        started()
        await gate
        return f.domain
      },
    }
    await rejects(
      executeDomainCommand(db.sql, reader, f.command, provider, f.key, now),
      'FORBIDDEN',
    )
    await rejects(
      executeDomainCommand(
        db.sql,
        owner,
        {
          ...f.command,
          payload: { ...f.command.payload, domain: 'mail.savingkc.com' },
        },
        provider,
        f.key,
        now,
      ),
      'PRIMARY_DOMAIN_OR_SUBDOMAIN_FORBIDDEN',
    )
    const pending = executeDomainCommand(
      db.sql,
      owner,
      f.command,
      provider,
      f.key,
      now,
    )
    await began
    const retry = await executeDomainCommand(
      db.sql,
      owner,
      { ...f.command, idempotencyKey: randomUUID() },
      provider,
      f.key,
      now,
    )
    assert.equal(retry.domains[0].state, 'creating')
    release()
    const saved = await pending
    assert.equal(creates, 1)
    assert.equal(saved.domains[0].state, 'needs_dns')
    assert.equal(saved.domains[0].paused, true)
    assert.equal(saved.domains[0].dns_records[0].value, 'fixture-provider-dkim')
    await executeDomainCommand(db.sql, owner, f.command, provider, f.key, now)
    assert.equal(creates, 1)
    assert.equal(
      JSON.stringify(saved).includes('re_fixture_domain_key_123456789'),
      false,
    )
  },
)

withDb(
  'uncertain domain creation is reconciled by reading and never blindly created again',
  async (db) => {
    const { executeDomainCommand } = await import(
      '../../src/lib/email/domains/service'
    )
    const f = await domainFixture(db)
    let creates = 0,
      finds = 0,
      found = false
    const provider = {
      ...f.provider,
      create: async () => {
        creates++
        throw Error('timed out')
      },
      find: async () => {
        finds++
        return found ? { ...f.domain, status: 'verified' } : null
      },
    }
    const uncertain = await executeDomainCommand(
      db.sql,
      owner,
      f.command,
      provider,
      f.key,
      now,
    )
    assert.equal(uncertain.domains[0].state, 'uncertain')
    await executeDomainCommand(
      db.sql,
      owner,
      { ...f.command, idempotencyKey: randomUUID() },
      provider,
      f.key,
      now,
    )
    assert.equal(creates, 1)
    found = true
    const verified = await executeDomainCommand(
      db.sql,
      owner,
      {
        command: 'DOM-VERIFY',
        idempotencyKey: randomUUID(),
        expectedRevision: uncertain.domains[0].revision,
        payload: { domainId: uncertain.entityId },
      },
      provider,
      f.key,
      now,
    )
    assert.equal(verified.domains[0].state, 'provider_verified')
    assert.equal(verified.domains[0].paused, true)
    assert.equal(creates, 1)
    assert.equal(finds, 2)
    await rejects(
      executeDomainCommand(
        db.sql,
        owner,
        {
          command: 'DOM-PAUSE',
          idempotencyKey: randomUUID(),
          expectedRevision: verified.domains[0].revision,
          payload: {
            domainId: verified.entityId,
            paused: false,
            reason: 'Try activating',
          },
        },
        provider,
        f.key,
        now,
      ),
      'DOMAIN_READINESS_REQUIRED',
    )
    const [ws] = await db.sql`select send_enabled from em_workspaces limit 1`
    assert.equal(ws.send_enabled, false)
  },
)

withDb(
  'sender activation is blocked and used identities cannot be swapped',
  async (db) => {
    const { executeDomainCommand } = await import(
      '../../src/lib/email/domains/service'
    )
    const f = await domainFixture(db)
    const domain = await executeDomainCommand(
      db.sql,
      owner,
      f.command,
      f.provider,
      f.key,
      now,
    )
    const command = {
      command: 'SND-SAVE',
      idempotencyKey: randomUUID(),
      expectedRevision: domain.revision,
      payload: {
        domainId: domain.entityId,
        fromName: 'Fixture sender',
        localPart: 'hello',
        signature: 'Fixture company',
        hourlyLimit: 5,
        dailyLimit: 20,
        state: 'paused',
      },
    }
    await rejects(
      executeDomainCommand(
        db.sql,
        owner,
        { ...command, payload: { ...command.payload, state: 'active' } },
        f.provider,
        f.key,
        now,
      ),
      'SENDER_TEST_REQUIRED',
    )
    const sender = await executeDomainCommand(
      db.sql,
      owner,
      command,
      f.provider,
      f.key,
      now,
    )
    const handoff = await reviewedCallback(db)
    await db.sql`update em_threads set sender_id=${sender.entityId} where id=${handoff.payload.threadId}`
    await rejects(
      executeDomainCommand(
        db.sql,
        owner,
        {
          ...command,
          idempotencyKey: randomUUID(),
          expectedRevision: 0,
          payload: {
            ...command.payload,
            senderId: sender.entityId,
            localPart: 'another',
          },
        },
        f.provider,
        f.key,
        now,
      ),
      'SENDER_IDENTITY_IN_USE',
    )
    const retired = await executeDomainCommand(
      db.sql,
      owner,
      {
        ...command,
        idempotencyKey: randomUUID(),
        expectedRevision: 0,
        payload: {
          ...command.payload,
          senderId: sender.entityId,
          state: 'retired',
        },
      },
      f.provider,
      f.key,
      now,
    )
    assert.equal(retired.senders[0].state, 'retired')
    const [thread] =
      await db.sql`select sender_id from em_threads where id=${handoff.payload.threadId}`
    assert.equal(thread.sender_id, sender.entityId)
  },
)

withDb(
  'disconnect during domain creation cannot mark a revoked provider ready',
  async (db) => {
    const { executeDomainCommand } = await import(
      '../../src/lib/email/domains/service'
    )
    const { readConnections, disconnectService } = await import(
      '../../src/lib/email/connections/service'
    )
    const f = await domainFixture(db)
    let release!: () => void, started!: () => void
    const gate = new Promise<void>((resolve) => {
        release = resolve
      }),
      began = new Promise<void>((resolve) => {
        started = resolve
      })
    const pending = executeDomainCommand(
      db.sql,
      owner,
      f.command,
      {
        ...f.provider,
        create: async () => {
          started()
          await gate
          return { ...f.domain, status: 'verified' }
        },
      },
      f.key,
      now,
    )
    await began
    const snapshot = await readConnections(db.sql, owner, f.key)
    await disconnectService(db.sql, owner, {
      connectionId: f.connected.connectionId,
      expectedRevision: snapshot.revision,
      confirmedAffectedHash: snapshot.disconnectImpact.hash,
      reason: 'Cancel setup',
      idempotencyKey: randomUUID(),
    })
    release()
    const result = await pending
    assert.equal(result.domains[0].state, 'held')
    assert.equal(result.domains[0].paused, true)
    assert.equal(result.domains[0].connection_state, 'revoked')
  },
)

withDb(
  'changing the main company domain invalidates saved sender setup',
  async (db) => {
    const { executeDomainCommand } = await import(
      '../../src/lib/email/domains/service'
    )
    const f = await domainFixture(db)
    await executeDomainCommand(db.sql, owner, f.command, f.provider, f.key, now)
    const [ws] = await db.sql`select revision,config from em_workspaces limit 1`
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'SET-BUSINESS',
        idempotencyKey: randomUUID(),
        expectedRevision: ws.revision,
        payload: {
          ...ws.config.business,
          primaryDomain: 'savingkc-outreach.com',
        },
      },
      now,
    )
    const [domain] = await db.sql`select state,paused from em_domains`
    assert.equal(domain.state, 'held')
    assert.equal(domain.paused, true)
  },
)

withDb('general scheduler creates independent CRM work, fences authority and prevents duplicate saves', async db => {
  const handoff = await reviewedCallback(db)
  handoff.payload.ownerId = owner
  handoff.payload.backupId = agent
  await executePilotCommand(db.sql, owner, handoff, now)
  const [thread] = await db.sql`select * from em_threads where id=${handoff.payload.threadId}`
  const command = {command:'THR-SCHEDULE',idempotencyKey:randomUUID(),payload:{threadId:thread.id,contentRevision:thread.content_revision,controllerRevision:thread.controller_revision,kind:'appointment',title:'Property walkthrough',note:'Meet at the property',assigneeId:agent,startAt:'2026-09-16T19:00:00Z',timezone:'America/Chicago'}}
  await rejects(executePilotCommand(db.sql, reader, command, now), 'FORBIDDEN')
  await rejects(executePilotCommand(db.sql, agent, command, now), 'THREAD_NOT_FOUND')
  await rejects(executePilotCommand(db.sql, owner, {...command,payload:{...command.payload,contentRevision:0}}, now), 'NEW_REPLY_REVIEW_REQUIRED')
  await rejects(executePilotCommand(db.sql, owner, {...command,payload:{...command.payload,assigneeId:reader}}, now), 'TASK_ASSIGNEE_UNAVAILABLE')
  await rejects(executePilotCommand(db.sql, owner, {...command,payload:{...command.payload,startAt:'2026-09-19T19:00:00Z'}}, now), 'INVALID_CALLBACK_TIME')
  const saved = await executePilotCommand(db.sql, owner, command, now)
  assert.equal(saved.state,'appointment_task_created')
  assert.deepEqual(await executePilotCommand(db.sql, owner, command, now),saved)
  const [item] = await db.sql`select * from work_items where source_id=${saved.entityId}`
  assert.equal(item.assigned_to,'Demo agent')
  assert.equal(item.lead_id,thread.lead_id)
  assert.equal(item.kind,'appointment')
  assert.equal(item.source_metadata.calendar_booking_verified,false)
  const alerts = await db.sql`select * from em_notifications where kind='task_assigned'`
  assert.equal(alerts.length,1)
  assert.equal(alerts[0].recipient_id,agent)
  assert.equal((await db.sql`select * from work_items where lead_id=${thread.lead_id}`).length,2)
  await db.sql`update em_handoffs set state='completed' where thread_id=${thread.id}`
  const task = await executePilotCommand(db.sql, owner, {...command,idempotencyKey:randomUUID(),payload:{...command.payload,kind:'task',title:'Research property'}},now)
  assert.equal(task.state,'task_created')
  const state = await readPilotState(db.sql,owner,now)
  assert.equal(state.threads.find(t=>t.id===thread.id)?.open_tasks?.length,3)
})

withDb('signed Resend webhook captures encrypted event, holds drip once and queues body retrieval', async db => {
  const {connectService} = await import('../../src/lib/email/connections/service')
  const {createResendWebhookHttp,webhookSecretAad} = await import('../../src/lib/email/inbound/capture')
  const {encryptEmailSecret,decryptEmailSecret} = await import('../../src/lib/email/secrets')
  const launchedState = await launched(db)
  const thread = launchedState.thread
  const key = Buffer.alloc(32,7), secret = `whsec_${Buffer.alloc(32,9).toString('base64')}`
  const [ws] = await db.sql`select id,revision from em_workspaces limit 1`
  const connection = await connectService(db.sql,owner,{provider:'resend',kind:'email',secret:'re_fixture_webhook_123456789',expectedRevision:ws.revision,accountLabel:'Webhook fixture',idempotencyKey:randomUUID()},async()=>({domainsRead:true,receivingRead:true,sendingVerified:false}),key,now)
  const endpoint = randomUUID()
  await db.sql`insert into em_webhook_endpoints(id,workspace_id,connection_id,encrypted_secret,active) values(${endpoint},${ws.id},${connection.connectionId},${db.sql.json({...encryptEmailSecret(secret,key,webhookSecretAad(ws.id,endpoint),1)})},true)`
  await db.sql`insert into em_reply_aliases(workspace_id,connection_id,thread_id,address) values(${ws.id},${connection.connectionId},${thread.id},'reply-token@outreach.test')`
  const handler = createResendWebhookHttp({database:()=>db.sql,endpointId:()=>endpoint,key:()=>key})
  const event = {type:'email.received',created_at:new Date().toISOString(),data:{email_id:randomUUID(),from:'seller@example.test',to:['reply-token@outreach.test'],message_id:'<rfc-id@example.test>'}}
  const raw = JSON.stringify(event), eventId = 'msg_fixture_verified'
  const request = (body=raw,id=eventId,offset=0,signingSecret=secret) => {
    const date = new Date(Date.now()+offset), timestamp = Math.floor(date.getTime()/1000).toString()
    return new Request('http://localhost/api/webhooks/email/resend',{method:'POST',headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':`v1,${createHmac('sha256',Buffer.from(signingSecret.slice(6),'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')}`},body})
  }
  assert.equal((await handler(request(raw,eventId,0,`whsec_${Buffer.alloc(32,1).toString('base64')}`))).status,401)
  assert.equal((await handler(request(raw,eventId,-600000))).status,401)
  assert.equal((await handler(request(raw,eventId,600000))).status,401)
  assert.equal((await db.sql`select * from em_provider_events`).length,0)
  assert.equal((await handler(request())).status,200)
  assert.equal((await handler(request())).status,200)
  const [saved] = await db.sql`select * from em_provider_events`
  assert.equal(decryptEmailSecret(saved.encrypted_payload,key,`${ws.id}/${saved.id}/resend-event/1`),raw)
  assert.equal(saved.provider_email_id,event.data.email_id)
  assert.equal((await db.sql`select * from em_jobs where kind='resend_receive_content'`).length,1)
  const [after] = await db.sql`select * from em_threads where id=${thread.id}`
  assert.equal(after.content_revision,thread.content_revision+1)
  assert.equal(after.inbound_pending,true)
  await rejects(executePilotCommand(db.sql,owner,{command:'THR-DRAFT',idempotencyKey:randomUUID(),payload:{threadId:thread.id,contentRevision:after.content_revision,controllerRevision:after.controller_revision,body:'Do not send before loading the reply.'}},now),'REPLY_CONTENT_PENDING')
  assert.equal((await db.sql`select * from em_send_intents where thread_id=${thread.id} and state='queued'`).length,0)
  assert.equal((await handler(request(JSON.stringify({...event,created_at:'2026-01-01T00:00:00Z'})))).status,409)
  assert.equal((await db.sql`select * from em_provider_events`).length,1)
  assert.equal((await readPilotState(db.sql,owner,now)).threads.find(t=>t.id===thread.id)?.inbound_pending,true)
  const unknown = JSON.stringify({...event,data:{...event.data,email_id:randomUUID(),to:['unknown@outreach.test']}})
  assert.equal((await handler(request(unknown,'msg_unknown'))).status,200)
  const [paused] = await db.sql`select pause_reason from em_workspaces where id=${ws.id}`
  assert.equal(paused.pause_reason,'Resend event needs review')
  assert.equal((await db.sql`select * from em_jobs where kind='resend_event_review' and state='dead'`).length,1)
  await db.sql`update em_service_connections set state='revoked' where id=${connection.connectionId}`
  assert.equal((await handler(request(raw,'msg_revoked'))).status,503)
  const oversized = new Request('http://localhost/api/webhooks/email/resend',{method:'POST',headers:{'content-length':'2097153'},body:'x'})
  await db.sql`update em_service_connections set state='checked' where id=${connection.connectionId}`
  assert.equal((await handler(oversized)).status,413)
  const largeBody = new Request('http://localhost/api/webhooks/email/resend',{method:'POST',body:'x'.repeat(2097153)})
  assert.equal((await handler(largeBody)).status,413)
  await assert.rejects(db.sql.begin(async tx=>{ await tx`set local role authenticated`; await tx`select * from em_webhook_endpoints` }))
  await assert.rejects(db.sql.begin(async tx=>{ await tx`set local role authenticated`; await tx`select encrypted_payload from em_provider_events` }))
  await db.sql`drop table em_jobs`
  assert.equal((await handler(request(unknown,'msg_storage_failure'))).status,503)
  assert.equal((await db.sql`select * from em_provider_events where provider_event_id='msg_storage_failure'`).length,0)
})

async function receivingFixture(db:Database) {
  const initial=await reviewedCallback(db)
  initial.payload.ownerId=owner;initial.payload.backupId=agent
  await executePilotCommand(db.sql,owner,initial,now)
  const [thread]=await db.sql`select t.*,a.normalized_address from em_threads t join em_addresses a on a.id=t.address_id where t.id=${initial.payload.threadId}`
  const {connectService}=await import('../../src/lib/email/connections/service')
  const {createResendWebhookHttp,webhookSecretAad}=await import('../../src/lib/email/inbound/capture')
  const {encryptEmailSecret}=await import('../../src/lib/email/secrets')
  const key=Buffer.alloc(32,7),secret=`whsec_${Buffer.alloc(32,9).toString('base64')}`
  const [ws]=await db.sql`select id,revision from em_workspaces limit 1`
  const connection=await connectService(db.sql,owner,{provider:'resend',kind:'email',secret:'re_fixture_receiving_123456789',expectedRevision:ws.revision,accountLabel:'Receiving fixture',idempotencyKey:randomUUID()},async()=>({domainsRead:true,receivingRead:true,sendingVerified:false}),key,now)
  const endpoint=randomUUID(),connectionId=connection.connectionId
  await db.sql`insert into em_webhook_endpoints(id,workspace_id,connection_id,encrypted_secret,active) values(${endpoint},${ws.id},${connectionId},${db.sql.json({...encryptEmailSecret(secret,key,webhookSecretAad(ws.id,endpoint),1)})},true)`
  await db.sql`insert into em_reply_aliases(workspace_id,connection_id,thread_id,address) values(${ws.id},${connectionId},${thread.id},'reply-token@outreach.test')`
  const content={id:randomUUID(),from:thread.normalized_address,to:['reply-token@outreach.test'],created_at:now.toISOString(),subject:'Re: property',message_id:`<${randomUUID()}@example.test>`,text:'Call me at 816-555-0112 tomorrow.',headers:{'In-Reply-To':'<sent@example.test>'},attachments:[]}
  const handler=createResendWebhookHttp({database:()=>db.sql,endpointId:()=>endpoint,key:()=>key})
  async function capture() {
    const body=JSON.stringify({type:'email.received',created_at:now.toISOString(),data:{email_id:content.id,from:content.from,to:content.to,message_id:content.message_id}}),id=`msg_${randomUUID()}`,timestamp=Math.floor(Date.now()/1000).toString()
    const signature=`v1,${createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')}`
    assert.equal((await handler(new Request('http://localhost/api/webhooks/email/resend',{method:'POST',headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':signature},body}))).status,200)
  }
  await capture()
  return {key,thread,content,connectionId,endpoint,capture}
}
withDb('receiving worker projects one authentic reply and phone alert into shared Lead history',async db=>{
  const f=await receivingFixture(db)
  const {processNextReceivedReply}=await import('../../src/lib/email/inbound/worker')
  let calls=0
  const provider={get:async()=>{calls++;return f.content}}
  const result=await processNextReceivedReply(db.sql,owner,provider,()=>now,f.key)
  assert.equal(result.state,'received')
  const [message]=await db.sql`select * from em_messages where transport='resend'`
  assert.equal(message.text_body,f.content.text)
  assert.equal(message.rfc_message_id,f.content.message_id)
  assert.equal(message.rfc_in_reply_to,'<sent@example.test>')
  assert.equal(message.provider_email_id,f.content.id)
  assert.equal((await db.sql`select * from lead_activities where metadata->>'em_message_id'=${message.id}`).length,1)
  assert.equal((await db.sql`select * from em_notifications where kind='Phone number received — review callback'`).length,1)
  assert.equal((await db.sql`select inbound_pending from em_threads where id=${f.thread.id}`)[0].inbound_pending,false)
  assert.equal((await processNextReceivedReply(db.sql,owner,provider,()=>now,f.key)).state,'idle')
  await f.capture()
  assert.equal((await processNextReceivedReply(db.sql,owner,provider,()=>now,f.key)).state,'already_received')
  assert.equal((await db.sql`select * from em_messages where transport='resend'`).length,1)
  assert.equal((await db.sql`select * from lead_activities where metadata->>'em_message_id'=${message.id}`).length,1)
  assert.equal(calls,2)
})
withDb('receiving worker retries temporary failures and never retries before due time',async db=>{
  const f=await receivingFixture(db)
  const {processNextReceivedReply}=await import('../../src/lib/email/inbound/worker')
  const {WorkflowError}=await import('../../src/lib/email/workflow/core')
  let current=now,calls=0
  const provider={get:async()=>{calls++;if(calls===1)throw new WorkflowError('REPLY_NOT_READY');return f.content}}
  assert.equal((await processNextReceivedReply(db.sql,owner,provider,()=>current,f.key)).state,'retry_scheduled')
  assert.equal((await processNextReceivedReply(db.sql,owner,provider,()=>current,f.key)).state,'idle')
  assert.equal(calls,1)
  current=new Date(now.getTime()+61000)
  assert.equal((await processNextReceivedReply(db.sql,owner,provider,()=>current,f.key)).state,'received')
})
withDb('an expired receiving worker cannot commit over a reclaimed lease',async db=>{
  const f=await receivingFixture(db)
  const {processNextReceivedReply}=await import('../../src/lib/email/inbound/worker')
  let current=now,release!:(value:unknown)=>void,started!:()=>void
  const ready=new Promise<void>(r=>{started=r})
  const old=processNextReceivedReply(db.sql,owner,{get:async()=>{started();return new Promise(r=>{release=r})}},()=>current,f.key)
  await ready
  current=new Date(now.getTime()+91000)
  assert.equal((await processNextReceivedReply(db.sql,owner,{get:async()=>f.content},()=>current,f.key)).state,'received')
  release(f.content)
  assert.equal((await old).state,'lease_lost')
  assert.equal((await db.sql`select * from em_messages where transport='resend'`).length,1)
})
withDb('disconnect or mismatched content holds receiving work without projecting a message',async db=>{
  const f=await receivingFixture(db)
  const {processNextReceivedReply}=await import('../../src/lib/email/inbound/worker')
  const mismatch=await processNextReceivedReply(db.sql,owner,{get:async()=>({...f.content,from:'stranger@example.test'})},()=>now,f.key)
  assert.equal(mismatch.state,'review_required')
  assert.equal((await db.sql`select * from em_messages where transport='resend'`).length,0)
  assert.equal((await db.sql`select inbound_pending from em_threads where id=${f.thread.id}`)[0].inbound_pending,true)
  await f.capture()
  const disconnected=await processNextReceivedReply(db.sql,owner,{get:async()=>{await db.sql`update em_service_connections set state='revoked' where id=${f.connectionId}`;return f.content}},()=>now,f.key)
  assert.equal(disconnected.state,'review_required')
  assert.equal((await db.sql`select * from em_messages where transport='resend'`).length,0)
})
withDb('a retrieved opt-out stops marketing even when CRM history projection fails',async db=>{
  const f=await receivingFixture(db)
  const {processNextReceivedReply}=await import('../../src/lib/email/inbound/worker')
  await db.sql`update lead_activities set description='Damaged history' where lead_id=${f.thread.lead_id} and activity_type='email'`
  const result=await processNextReceivedReply(db.sql,owner,{get:async()=>({...f.content,text:'Please remove me from your list.'})},()=>now,f.key)
  assert.equal(result.state,'unsubscribed')
  assert.equal((await db.sql`select state from em_threads where id=${f.thread.id}`)[0].state,'stopped')
  assert.equal((await db.sql`select * from em_suppressions where address_id=${f.thread.address_id}`).length,1)
  assert.equal((await db.sql`select * from em_crm_projection_repairs where thread_id=${f.thread.id} and state='pending'`).length,1)
})
withDb('owner receiving retry is audited and replayable without bypassing identity review',async db=>{
  const f=await receivingFixture(db)
  const {processNextReceivedReply}=await import('../../src/lib/email/inbound/worker')
  const {WorkflowError}=await import('../../src/lib/email/workflow/core')
  const {readReceivingWork,createReceivingHttp}=await import('../../src/lib/email/inbound/operations')
  await processNextReceivedReply(db.sql,owner,{get:async()=>{throw new WorkflowError('REPLY_CONNECTION_REJECTED')}},()=>now,f.key)
  const state=await readReceivingWork(db.sql,owner)
  const job=state.jobs[0]
  assert.equal(job.can_retry,true)
  await rejects(readReceivingWork(db.sql,reader),'FORBIDDEN')
  const retry={command:'OPS-REPLAY',idempotencyKey:randomUUID(),payload:{jobId:job.id,expectedFailureCode:'REPLY_CONNECTION_REJECTED',reason:'Owner verified provider permissions and requested another fetch.'}}
  await rejects(executePilotCommand(db.sql,agent,retry,now),'FORBIDDEN')
  assert.equal((await executePilotCommand(db.sql,owner,retry,now)).state,'reply_retry_queued')
  await executePilotCommand(db.sql,owner,retry,now)
  assert.equal((await db.sql`select * from em_audit_events where action='RECEIVING-RETRY'`).length,1)
  assert.equal((await processNextReceivedReply(db.sql,owner,{get:async()=>f.content},()=>now,f.key)).state,'received')
  const http=createReceivingHttp({database:()=>db.sql,subject:async()=>owner})
  assert.equal((await http.POST(new Request('http://localhost/api/email/receiving',{method:'POST',headers:{Origin:'https://other.test','Content-Type':'application/json'},body:'{"action":"process_next"}'}))).status,403)
})
withDb('multiple pending replies retain the conversation hold until every body is resolved',async db=>{
  const f=await receivingFixture(db)
  const {processNextReceivedReply}=await import('../../src/lib/email/inbound/worker')
  const first={...f.content}
  f.content.id=randomUUID();f.content.message_id=`<${randomUUID()}@example.test>`;f.content.text='Wednesday is better.'
  await f.capture()
  const provider={get:async(_secret:string,id:string)=>id===first.id?first:f.content}
  await processNextReceivedReply(db.sql,owner,provider,()=>now,f.key)
  assert.equal((await db.sql`select inbound_pending from em_threads where id=${f.thread.id}`)[0].inbound_pending,true)
  await processNextReceivedReply(db.sql,owner,provider,()=>now,f.key)
  assert.equal((await db.sql`select inbound_pending from em_threads where id=${f.thread.id}`)[0].inbound_pending,false)
  assert.equal((await db.sql`select * from em_messages where transport='resend'`).length,2)
})

withDb('public unsubscribe stops outreach after issuer removal and is idempotent with honest attribution', async (db) => {
  const { issuePreferenceToken, unsubscribeWithToken } = await import('../../src/lib/email/preferences/service')
  const { preferenceConfirmation, createPreferencePost } = await import('../../src/lib/email/preferences/http')
  const command = await reviewedCallback(db)
  const handoff = await executePilotCommand(db.sql, owner, command, now)
  const [thread] = await db.sql`select * from em_threads where id=${command.payload.threadId}`
  const keys = { '1': 'ab'.repeat(32), '2': 'cd'.repeat(32) }
  await rejects(issuePreferenceToken(db.sql, reader, thread.address_id, keys, now), 'FORBIDDEN')
  const token = await issuePreferenceToken(db.sql, owner, thread.address_id, keys, now)
  assert.match(token, /^2\./)
  const confirmation = preferenceConfirmation(token)
  assert.equal(confirmation.status, 200)
  assert.match(await confirmation.text(), /method="post"/)
  assert.equal((await db.sql`select * from em_suppressions`).length, 0)
  const [stored] = await db.sql`select * from em_preference_tokens`
  assert.ok(!JSON.stringify(stored).includes(token))
  await db.sql`update em_memberships set active=false where auth_user_id=${owner}`
  const post = createPreferencePost(() => db.sql, keys)
  const response = await post(new Request('https://crm.savingkc.test/api/email/unsubscribe/'+token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'List-Unsubscribe=One-Click',
  }), token)
  assert.equal(response.status, 200)
  assert.match(await response.text(), /You’re unsubscribed/)
  const [suppression] = await db.sql`select * from em_suppressions where address_id=${thread.address_id}`
  assert.equal(suppression.created_by, null)
  assert.equal(suppression.reason, 'unsubscribe')
  assert.equal((await db.sql`select state from em_threads where id=${thread.id}`)[0].state, 'stopped')
  assert.equal((await db.sql`select state from em_handoffs where id=${handoff.entityId}`)[0].state, 'held')
  const [event] = await db.sql`select * from work_item_events where action='email_hold'`
  assert.equal(event.actor, 'public_unsubscribe')
  const revision = (await db.sql`select restriction_revision from em_addresses where id=${thread.address_id}`)[0].restriction_revision
  assert.equal(await unsubscribeWithToken(db.sql, token, keys, now), true)
  assert.equal((await db.sql`select restriction_revision from em_addresses where id=${thread.address_id}`)[0].restriction_revision, revision)
  const audits = await db.sql`select * from em_audit_events where action='PUBLIC-UNSUBSCRIBE'`
  assert.equal(audits.length, 1)
  assert.equal(audits[0].actor_id, null)
  // If a later explicit consent workflow releases suppression, the old link still works.
  await db.sql`delete from em_suppressions where address_id=${thread.address_id}`
  assert.equal(await unsubscribeWithToken(db.sql, token, keys, now), true)
  assert.equal((await db.sql`select * from em_suppressions where address_id=${thread.address_id}`).length, 1)
})

async function qualifyPayload(
  db: Database,
  handoffId: string,
  threadId: string,
  extras: Record<string, unknown> = {},
) {
  const t = (await readPilotState(db.sql, agent, now)).threads.find(
    (row) => row.id === threadId,
  )!
  const inbound = (await readPilotState(db.sql, agent, now)).messages
    .filter((m) => m.thread_id === threadId && m.direction === 'inbound')
    .at(-1)!
  const verified = {
    state: 'verified' as const,
    evidenceIds: [inbound.id],
    note: 'Confirmed from the seller reply.',
  }
  return {
    command: 'HAN-QUALIFY' as const,
    idempotencyKey: randomUUID(),
    expectedRevision: t.handoff_revision,
    payload: {
      handoffId,
      leadId: t.lead_id!,
      leadRevision: Math.round(Number(t.lead_revision)),
      nextAction: 'Call to confirm next steps',
      evidenceIds: [inbound.id],
      assessment: {
        personAuthority: { state: 'confirmed' as const, evidenceIds: [inbound.id] },
        propertyRef: t.property!.address,
        timeline: verified,
        condition: verified,
        motivation: verified,
        price: verified,
        whyWorthPursuing: 'Seller asked to discuss a sale of this property.',
      },
      ...extras,
    },
  }
}

withDb(
  'return for clarification holds the callback without changing the Lead or resuming sends',
  async (db) => {
    const initial = await reviewedCallback(db)
    const handoff = await executePilotCommand(db.sql, owner, initial, now)
    const command = {
      command: 'HAN-RETURN',
      idempotencyKey: randomUUID(),
      expectedRevision: 0,
      payload: {
        handoffId: handoff.entityId,
        question: 'Which afternoon window did the seller confirm?',
        reviewerId: owner,
      },
    }
    await rejects(executePilotCommand(db.sql, reader, command, now), 'FORBIDDEN')
    const result = await executePilotCommand(db.sql, agent, command, now)
    assert.equal(result.state, 'returned_for_clarification')
    assert.deepEqual(await executePilotCommand(db.sql, agent, command, now), result)
    const [saved] = await db.sql`select * from em_handoffs where id=${handoff.entityId}`
    assert.equal(saved.state, 'held')
    assert.equal(saved.access_hold_reason, 'clarification_required')
    assert.equal(saved.clarification_question, command.payload.question)
    const [lead] = await db.sql`select station,classification from leads`
    assert.equal(lead.station, 'contacted')
    assert.equal(lead.classification, 'lead')
    assert.equal(
      (await db.sql`select count(*)::int as n from em_send_intents where thread_id=${initial.payload.threadId} and state='queued'`)[0].n,
      0,
    )
    assert.equal(
      (await db.sql`select status from work_items`)[0].status,
      'blocked',
    )
    const notices = await readPilotState(db.sql, owner, now)
    assert.ok(
      notices.notifications.some((n) =>
        n.kind.startsWith('Clarification needed'),
      ),
    )
  },
)

withDb(
  'shared ownership updates every open Email callback for the same Lead together',
  async (db) => {
    const first = await reviewedCallback(db)
    const firstHandoff = await executePilotCommand(db.sql, owner, first, now)
    await simulateDelivery(db.sql, owner, randomUUID(), now)
    const firstThread = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === first.payload.threadId,
    )!
    const secondThread = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id !== first.payload.threadId && t.has_outbound,
    )!
    const inbound = (await readPilotState(db.sql, owner, now)).messages
      .filter((m) => m.thread_id === secondThread.id && m.direction === 'inbound')
      .at(-1)
    if (!inbound) {
      await simulateInbound(
        db.sql,
        owner,
        {
          threadId: secondThread.id,
          eventId: randomUUID(),
          body: 'I would consider selling this property. Please call me.',
        },
        new Date(now.getTime() + 2000),
      )
    }
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-TAKEOVER',
        idempotencyKey: randomUUID(),
        payload: {
          threadId: secondThread.id,
          expectedControllerRevision: secondThread.controller_revision,
        },
      },
      now,
    )
    const afterTakeover = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === secondThread.id,
    )!
    const secondInbound = (await readPilotState(db.sql, owner, now)).messages
      .filter((m) => m.thread_id === secondThread.id && m.direction === 'inbound')
      .at(-1)!
    const secondHandoff = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'THR-HANDOFF',
        expectedRevision: afterTakeover.content_revision,
        idempotencyKey: randomUUID(),
        payload: {
          threadId: secondThread.id,
          ownerId: agent,
          backupId: owner,
          reason: 'Second callback on the same seller',
          positiveSellerInterest: true,
          requestedContact: {},
          factEvidence: [
            {
              source: 'message',
              messageId: secondInbound.id,
              quote: secondInbound.text_body,
            },
          ],
        },
      },
      now,
    )
    await db.sql`update em_threads set lead_id=${firstThread.lead_id} where id=${secondThread.id}`
    await db.sql`update em_handoffs set lead_id=${firstThread.lead_id} where id=${secondHandoff.entityId}`
    const [secondTask] =
      await db.sql`select crm_task_id from em_handoffs where id=${secondHandoff.entityId}`
    await db.sql`update lead_activities set lead_id=${firstThread.lead_id} where id=${secondTask.crm_task_id}`
    const current = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === first.payload.threadId,
    )!
    const related = current.open_related_handoffs ?? []
    assert.equal(related.length, 1)
    const command = {
      command: 'HAN-REASSIGN',
      idempotencyKey: randomUUID(),
      expectedRevision: current.handoff_revision,
      payload: {
        handoffId: firstHandoff.entityId,
        newOwnerId: owner,
        backupId: agent,
        reason: 'One owner for both open callbacks',
        expectedCrmOwner: 'Demo agent',
        contentRevision: current.content_revision,
        controllerRevision: current.controller_revision,
      },
    }
    await rejects(executePilotCommand(db.sql, owner, command, now), 'MULTIPLE_HANDOFFS_REQUIRE_REVIEW')
    const sibling = related[0]
    await executePilotCommand(
      db.sql,
      agent,
      {
        command: 'HAN-RETURN',
        idempotencyKey: randomUUID(),
        expectedRevision: sibling.revision,
        payload: {
          handoffId: sibling.id,
          question: 'Which listing did this second reply refer to?',
          reviewerId: owner,
        },
      },
      now,
    )
    const afterReturn = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === first.payload.threadId,
    )!
    const relatedAfter = afterReturn.open_related_handoffs ?? []
    assert.equal(relatedAfter.length, 1)
    assert.equal(relatedAfter[0].revision, sibling.revision + 1)
    command.payload.relatedHandoffs = related.map((item) => ({
      handoffId: item.id,
      expectedRevision: item.revision,
    }))
    await rejects(executePilotCommand(db.sql, owner, command, now), 'MULTIPLE_HANDOFFS_REQUIRE_REVIEW')
    command.payload.relatedHandoffs = relatedAfter.map((item) => ({
      handoffId: item.id,
      expectedRevision: item.revision,
    }))
    command.expectedRevision = afterReturn.handoff_revision
    command.payload.contentRevision = afterReturn.content_revision
    command.payload.controllerRevision = afterReturn.controller_revision
    const result = await executePilotCommand(db.sql, owner, command, now)
    assert.equal(result.state, 'callback_reassigned')
    const [lead] = await db.sql`select assigned_agent from leads where id=${current.lead_id}`
    assert.equal(lead.assigned_agent, 'Demo owner')
    const owners = await db.sql`select owner_id,state,access_hold_reason from em_handoffs where lead_id=${current.lead_id} and state<>'completed'`
    assert.equal(owners.length, 2)
    assert.ok(owners.every((row) => row.owner_id === owner && row.state === 'needs_contact' && row.access_hold_reason === null))
    const tasks = await db.sql`select assigned_to,status from work_items where lead_id=${current.lead_id}`
    assert.ok(tasks.length >= 2)
    assert.ok(tasks.every((row) => row.assigned_to === 'Demo owner' && row.status === 'pending'))
  },
)

withDb(
  'access-hold release assigns an eligible owner without resuming marketing',
  async (db) => {
    const initial = await reviewedCallback(db)
    const handoff = await executePilotCommand(db.sql, owner, initial, now)
    const readerMember = (
      await readPilotState(db.sql, owner, now)
    ).settings!.members.find((m) => m.id === reader)!
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'SET-ROLES',
        idempotencyKey: randomUUID(),
        expectedRevision: readerMember.revision,
        payload: {
          authUserId: reader,
          roles: ['acquisitions'],
          active: true,
          affectedWorkHash: readerMember.affectedWorkHash,
        },
      },
      now,
    )
    const agentMember = (
      await readPilotState(db.sql, owner, now)
    ).settings!.members.find((m) => m.id === agent)!
    await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'SET-ROLES',
        idempotencyKey: randomUUID(),
        expectedRevision: agentMember.revision,
        payload: {
          authUserId: agent,
          roles: ['reader'],
          active: true,
          affectedWorkHash: agentMember.affectedWorkHash,
        },
      },
      now,
    )
    const held = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    assert.equal(held.handoff_state, 'held')
    assert.equal(held.access_hold_reason, 'team_role_changed')
    assert.equal(held.callback_task_state, 'blocked')
    const result = await executePilotCommand(
      db.sql,
      owner,
      {
        command: 'HAN-REASSIGN',
        idempotencyKey: randomUUID(),
        expectedRevision: held.handoff_revision,
        payload: {
          handoffId: handoff.entityId,
          newOwnerId: owner,
          backupId: reader,
          reason: 'Owner covering after access change',
          expectedCrmOwner: held.crm_owner_name,
          contentRevision: held.content_revision,
          controllerRevision: held.controller_revision,
        },
      },
      now,
    )
    assert.equal(result.state, 'callback_released')
    const current = (await readPilotState(db.sql, owner, now)).threads.find(
      (t) => t.id === initial.payload.threadId,
    )!
    assert.equal(current.handoff_state, 'needs_contact')
    assert.equal(current.access_hold_reason, null)
    assert.equal(current.callback_task_state, 'pending')
    assert.equal(current.handoff_owner_id, owner)
    assert.equal(
      (
        await db.sql`select count(*)::int as n from em_send_intents where thread_id=${initial.payload.threadId} and state='queued'`
      )[0].n,
      0,
    )
  },
)

withDb(
  'qualification uses four verified pillars and the current Lead revision',
  async (db) => {
    const initial = await reviewedCallback(db)
    const handoff = await executePilotCommand(db.sql, owner, initial, now)
    const incomplete = await qualifyPayload(
      db,
      handoff.entityId,
      initial.payload.threadId,
      {
        assessment: {
          personAuthority: { state: 'unknown', evidenceIds: [] },
          propertyRef: 'not-this-property',
          timeline: { state: 'unknown', evidenceIds: [] },
          condition: { state: 'unknown', evidenceIds: [] },
          motivation: { state: 'unknown', evidenceIds: [] },
          price: { state: 'unknown', evidenceIds: [] },
          whyWorthPursuing: 'Not enough evidence.',
        },
      },
    )
    await rejects(
      executePilotCommand(db.sql, agent, incomplete, now),
      'PERSON_AUTHORITY_REQUIRED',
    )
    const stale = await qualifyPayload(
      db,
      handoff.entityId,
      initial.payload.threadId,
    )
    stale.payload.leadRevision = stale.payload.leadRevision - 1_000
    await rejects(executePilotCommand(db.sql, agent, stale, now), 'LEAD_CHANGED')
    const command = await qualifyPayload(
      db,
      handoff.entityId,
      initial.payload.threadId,
    )
    await rejects(
      executePilotCommand(db.sql, reader, command, now),
      'FORBIDDEN',
    )
    const result = await executePilotCommand(db.sql, agent, command, now)
    assert.equal(result.state, 'opportunity_qualified')
    assert.deepEqual(await executePilotCommand(db.sql, agent, command, now), result)
    const [lead] = await db.sql`select station,classification,source from leads`
    assert.equal(lead.station, 'qualified')
    assert.equal(lead.classification, 'opportunity')
    assert.equal(lead.source, 'email_marketing')
    assert.equal(
      (
        await db.sql`select count(*)::int as n from crm_lead_qualification_pillars where status='verified'`
      )[0].n,
      4,
    )
  },
)

withDb(
  'qualification preserves an already advanced Opportunity stage',
  async (db) => {
    const initial = await reviewedCallback(db)
    const existing = await existingLead(db, initial.payload.threadId)
    const handoff = await executePilotCommand(db.sql, owner, initial, now)
    assert.equal(handoff.state, 'handoff_saved_crm_synced')
    const command = await qualifyPayload(
      db,
      handoff.entityId,
      initial.payload.threadId,
    )
    const result = await executePilotCommand(db.sql, agent, command, now)
    assert.equal(result.state, 'qualification_recorded')
    const [lead] = await db.sql`select station,source from leads where id=${existing}`
    assert.equal(lead.station, 'qualified')
    assert.equal(lead.source, 'legacy_partner')
  },
)

withDb(
  'unacknowledged callback alerts escalate to backup after five operating minutes',
  async (db) => {
    const initial = await reviewedCallback(db)
    await executePilotCommand(db.sql, owner, initial, now)
    const early = await simulateHandoffEscalation(
      db.sql,
      owner,
      randomUUID(),
      now,
    )
    assert.equal(early.state, 'no_due_escalations')
    const later = new Date(now.getTime() + 5 * 60 * 1000)
    const result = await simulateHandoffEscalation(
      db.sql,
      owner,
      randomUUID(),
      later,
    )
    assert.equal(result.state, 'handoff_escalated')
    const replay = await simulateHandoffEscalation(
      db.sql,
      owner,
      randomUUID(),
      later,
    )
    assert.equal(replay.state, 'no_due_escalations')
    const backupNotices = (await readPilotState(db.sql, owner, later)).notifications
      .filter((n) => n.kind.includes('backup review'))
    assert.equal(backupNotices.length, 1)
    assert.equal(
      (
        await db.sql`select count(*)::int as n from em_notifications where logical_key like 'handoff-escalation:%'`
      )[0].n,
      1,
    )
    const ownerState = await readPilotState(db.sql, agent, later)
    const ownerNotice = ownerState.notifications.find((n) =>
      n.kind.startsWith('Callback'),
    )!
    await executePilotCommand(
      db.sql,
      agent,
      {
        command: 'NTF-ACK',
        idempotencyKey: randomUUID(),
        payload: { eventId: ownerNotice.id, eventRevision: 0 },
      },
      later,
    )
    assert.equal(
      (
        await db.sql`select count(*)::int as n from em_notifications where logical_key like 'handoff-escalation:%' and acknowledged_at is null`
      )[0].n,
      0,
    )
  },
)


withDb('unsubscribe retains old keys, rejects forged links, and commits despite broken CRM history', async (db) => {
  const { issuePreferenceToken, unsubscribeWithToken } = await import('../../src/lib/email/preferences/service')
  const command = await reviewedCallback(db)
  await executePilotCommand(db.sql, owner, command, now)
  const [thread] = await db.sql`select * from em_threads where id=${command.payload.threadId}`
  const old = { '1': 'ab'.repeat(32) }, rotated = { ...old, '2': 'cd'.repeat(32) }
  const token = await issuePreferenceToken(db.sql, owner, thread.address_id, old, now)
  assert.equal(await unsubscribeWithToken(db.sql, '1.'+'x'.repeat(43), rotated, now), false)
  assert.equal(await unsubscribeWithToken(db.sql, 'invalid', rotated, now), false)
  await rejects(unsubscribeWithToken(db.sql, token, {}, now), 'PREFERENCE_KEY_REQUIRED')
  await db.sql`update lead_activities set description='Broken projection' where activity_type='email'`
  assert.equal(await unsubscribeWithToken(db.sql, token, rotated, now), true)
  assert.equal((await db.sql`select * from em_suppressions where address_id=${thread.address_id}`).length, 1)
  assert.equal((await db.sql`select state from em_crm_projection_repairs where thread_id=${thread.id}`)[0].state, 'pending')
})

withDb('credential rotation, webhook secret lifecycle and replacement review stay local', async (db) => {
  const { connectService, readConnections } = await import('../../src/lib/email/connections/service')
  const {
    rotateCredentialSecrets,
    saveWebhookEndpoint,
    reviewConnectionReplacement,
  } = await import('../../src/lib/email/connections/lifecycle')
  const { decryptEmailSecret } = await import('../../src/lib/email/secrets')
  const { webhookSecretAad } = await import('../../src/lib/email/connections/aad')
  const { connectionSecretAad } = await import('../../src/lib/email/connections/aad')
  const v1 = Buffer.alloc(32, 7),
    v2 = Buffer.alloc(32, 8)
  const ring = new Map([[1, v1], [2, v2]])
  const [{ revision }] = await db.sql`select revision from em_workspaces limit 1`
  const first = await connectService(
    db.sql,
    owner,
    {
      kind: 'email',
      provider: 'resend',
      secret: 're_fixture_rotate_one_123456',
      expectedRevision: revision,
      accountLabel: 'First fixture',
      idempotencyKey: randomUUID(),
    },
    async () => ({ domainsRead: true, receivingRead: true, sendingVerified: false }),
    v1,
    now,
  )
  const second = await connectService(
    db.sql,
    owner,
    {
      kind: 'email',
      provider: 'resend',
      secret: 're_fixture_rotate_two_987654',
      expectedRevision: first.revision,
      accountLabel: 'Second fixture',
      idempotencyKey: randomUUID(),
    },
    async () => ({ domainsRead: true, receivingRead: true, sendingVerified: false }),
    v1,
    now,
  )
  const signing = `whsec_${Buffer.alloc(32, 5).toString('base64')}`
  const webhook = await saveWebhookEndpoint(
    db.sql,
    owner,
    {
      connectionId: first.connectionId,
      secret: signing,
      expectedRevision: second.revision,
      idempotencyKey: randomUUID(),
    },
    v1,
    1,
    now,
  )
  const [inactive] =
    await db.sql`select active from em_webhook_endpoints where id=${webhook.endpointId}`
  assert.equal(inactive.active, false)
  await rotateCredentialSecrets(
    db.sql,
    owner,
    { expectedRevision: second.revision, idempotencyKey: randomUUID() },
    ring,
    now,
  )
  const [rotated] = await db.sql`select * from em_service_connections where id=${first.connectionId}`
  assert.equal(rotated.key_version, 2)
  assert.equal(
    decryptEmailSecret(
      rotated.encrypted_secret,
      v2,
      connectionSecretAad(rotated.workspace_id, rotated.id, 2),
    ),
    're_fixture_rotate_one_123456',
  )
  const [hook] = await db.sql`select * from em_webhook_endpoints where id=${webhook.endpointId}`
  assert.equal(hook.key_version, 2)
  assert.equal(
    decryptEmailSecret(hook.encrypted_secret, v2, webhookSecretAad(hook.workspace_id, hook.id, 2)),
    signing,
  )
  const snapshot = await readConnections(db.sql, owner, v2)
  await reviewConnectionReplacement(
    db.sql,
    owner,
    {
      connectionId: second.connectionId,
      replacesConnectionId: first.connectionId,
      expectedRevision: snapshot.revision,
      confirmedAffectedHash: snapshot.replacementReview.hash,
      reason: 'Owner reviewed the newer checked account.',
      idempotencyKey: randomUUID(),
    },
    now,
  )
  const [prior] =
    await db.sql`select superseded_by,replacement_review_reason from em_service_connections where id=${first.connectionId}`
  assert.equal(prior.superseded_by, second.connectionId)
  assert.equal((await db.sql`select send_enabled from em_workspaces`)[0].send_enabled, false)
})

withDb('delivery events reduce when matched and unmatched events stay reviewable', async (db) => {
  const { connectService } = await import('../../src/lib/email/connections/service')
  const { createResendWebhookHttp, webhookSecretAad } = await import('../../src/lib/email/inbound/capture')
  const { encryptEmailSecret } = await import('../../src/lib/email/secrets')
  const launchedState = await launched(db)
  const [intent] =
    await db.sql`select * from em_send_intents where thread_id=${launchedState.thread.id} and state='accepted_simulated'`
  const providerEmailId = randomUUID()
  await db.sql`update em_send_intents set provider_message_id=${providerEmailId} where id=${intent.id}`
  const key = Buffer.alloc(32, 7),
    secret = `whsec_${Buffer.alloc(32, 9).toString('base64')}`
  const [ws] = await db.sql`select id,revision from em_workspaces limit 1`
  const connection = await connectService(
    db.sql,
    owner,
    {
      provider: 'resend',
      kind: 'email',
      secret: 're_fixture_reducer_123456789',
      expectedRevision: ws.revision,
      accountLabel: 'Reducer fixture',
      idempotencyKey: randomUUID(),
    },
    async () => ({ domainsRead: true, receivingRead: true, sendingVerified: false }),
    key,
    now,
  )
  const endpoint = randomUUID()
  await db.sql`insert into em_webhook_endpoints(id,workspace_id,connection_id,encrypted_secret,active)
    values(${endpoint},${ws.id},${connection.connectionId},${db.sql.json({
      ...encryptEmailSecret(secret, key, webhookSecretAad(ws.id, endpoint), 1),
    })},true)`
  const handler = createResendWebhookHttp({
    database: () => db.sql,
    endpointId: () => endpoint,
    key: () => key,
  })
  const signed = (type: string, emailId: string, id: string) => {
    const body = JSON.stringify({
      type,
      created_at: now.toISOString(),
      data: { email_id: emailId },
    })
    const timestamp = Math.floor(Date.now() / 1000).toString()
    return new Request('http://localhost/api/webhooks/email/resend', {
      method: 'POST',
      headers: {
        'svix-id': id,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')}`,
      },
      body,
    })
  }
  assert.equal((await handler(signed('email.delivered', providerEmailId, 'evt_delivered'))).status, 200)
  assert.equal((await db.sql`select pause_reason from em_workspaces where id=${ws.id}`)[0].pause_reason, null)
  assert.equal((await db.sql`select * from em_delivery_facts where type='email.delivered'`).length, 1)
  assert.equal((await db.sql`select remote_outcome from em_send_intents where id=${intent.id}`)[0].remote_outcome, 'delivered')
  assert.equal((await handler(signed('email.opened', providerEmailId, 'evt_opened'))).status, 200)
  assert.equal((await db.sql`select pause_reason from em_workspaces where id=${ws.id}`)[0].pause_reason, null)
  assert.equal((await handler(signed('email.bounced', providerEmailId, 'evt_bounced'))).status, 200)
  assert.equal((await db.sql`select * from em_suppressions where address_id=${launchedState.thread.address_id}`).length, 1)
  assert.equal((await handler(signed('email.delivered', randomUUID(), 'evt_unknown'))).status, 200)
  const [paused] = await db.sql`select pause_reason from em_workspaces where id=${ws.id}`
  assert.equal(paused.pause_reason, 'Resend event needs review')
  const [review] =
    await db.sql`select * from em_jobs where kind='resend_event_review' and state='dead'`
  const ack = await executePilotCommand(
    db.sql,
    owner,
    {
      command: 'OPS-ACK',
      idempotencyKey: randomUUID(),
      payload: {
        incidentKey: `resend_event_review:${review.id}`,
        note: 'Owner reviewed the unmatched delivery event.',
      },
    },
    now,
  )
  assert.equal(ack.state, 'review_released')
  assert.equal((await db.sql`select pause_reason from em_workspaces where id=${ws.id}`)[0].pause_reason, null)
})

withDb('remote dispatch stays fenced and reconcile cannot resend', async (db) => {
  const { enqueueRemoteDispatch, processNextDispatch } = await import('../../src/lib/email/dispatch/service')
  await launched(db)
  const [intent] = await db.sql`select * from em_send_intents where state='queued' limit 1`
  const [ws] = await db.sql`select revision from em_workspaces limit 1`
  const queued = await enqueueRemoteDispatch(
    db.sql,
    owner,
    {
      intentId: intent.id,
      expectedRevision: ws.revision,
      idempotencyKey: randomUUID(),
    },
    now,
  )
  assert.equal(queued.state, 'dispatch_queued')
  process.env.EMAIL_LIVE_DISPATCH_ENABLED = 'true'
  process.env.EMAIL_CONTROLLED_PROVIDER_EVIDENCE = 'true'
  try {
    await db.sql`update em_workspaces set send_enabled=true`
    const held = await processNextDispatch(db.sql, owner, () => now)
    assert.equal(held.state, 'held')
    assert.equal(held.reason, 'CONTROLLED_PROVIDER_EVIDENCE_REQUIRED')
  } finally {
    await db.sql`update em_workspaces set send_enabled=false`
    delete process.env.EMAIL_LIVE_DISPATCH_ENABLED
    delete process.env.EMAIL_CONTROLLED_PROVIDER_EVIDENCE
  }
  const [saved] = await db.sql`select state,cancellation_reason from em_send_intents where id=${intent.id}`
  assert.equal(saved.state, 'held')
  assert.equal(saved.cancellation_reason, 'CONTROLLED_PROVIDER_EVIDENCE_REQUIRED')
  const reconciled = await executePilotCommand(
    db.sql,
    owner,
    {
      command: 'OPS-RECONCILE',
      idempotencyKey: randomUUID(),
      payload: { intentId: intent.id },
    },
    now,
  )
  assert.equal(reconciled.state, 'reconciled_held')
  assert.equal((await db.sql`select state from em_send_intents where id=${intent.id}`)[0].state, 'held')
  assert.equal((await db.sql`select send_enabled from em_workspaces`)[0].send_enabled, false)
})

withDb('simulated outbound stores List-Unsubscribe when preference keys exist', async (db) => {
  const { recordPreference } = await import('../../src/lib/email/preferences/service')
  const { createPreferencePost } = await import('../../src/lib/email/preferences/http')
  process.env.EMAIL_PREFERENCE_KEY_V1 = 'ab'.repeat(32)
  try {
    const state = await launched(db)
    const [intent] =
      await db.sql`select frozen_payload from em_send_intents where thread_id=${state.thread.id} order by created_at limit 1`
    const headers = intent.frozen_payload.headers
    assert.match(headers['List-Unsubscribe'], /\/api\/email\/unsubscribe\/1\.[A-Za-z0-9_-]{43}/)
    assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click')
    const token = headers['List-Unsubscribe'].slice(1, -1).split('/').pop()
    const post = createPreferencePost(() => db.sql, { '1': 'ab'.repeat(32) })
    const stopped = await post(
      new Request('https://crm.savingkc.test/api/email/unsubscribe/' + token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'List-Unsubscribe=One-Click',
      }),
      token,
    )
    assert.match(await stopped.text(), /Save program note/)
    const noted = await recordPreference(
      db.sql,
      token,
      'seller_outreach',
      { '1': 'ab'.repeat(32) },
      now,
    )
    assert.equal(noted, true)
    assert.equal(
      (await db.sql`select program from em_preference_choices where address_id=${state.thread.address_id}`)[0]
        .program,
      'seller_outreach',
    )
  } finally {
    delete process.env.EMAIL_PREFERENCE_KEY_V1
  }
})

