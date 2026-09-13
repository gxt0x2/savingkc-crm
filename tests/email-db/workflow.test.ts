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
