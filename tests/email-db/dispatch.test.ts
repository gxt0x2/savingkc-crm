import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  startDisposableDatabase,
  fixtureOwner as owner,
  fixtureNow,
} from "../email-local/database.mjs";
import {
  executePilotCommand,
  getPilotReview,
  simulateDelivery,
} from "../../src/lib/email/workflow/service";
import { processNextDispatch } from "../../src/lib/email/dispatch/service";
import { freezeHostedEnvelope } from "../../src/lib/email/providers/frozen-envelope";
import { encryptEmailSecret } from "../../src/lib/email/secrets";
import { workflowHash, type Tx } from "../../src/lib/email/workflow/core";
const now = new Date(fixtureNow),
  key = Buffer.alloc(32, 7);
process.env.EMAIL_CREDENTIALS_KEY_V1 = key.toString("hex");
process.env.EMAIL_PREFERENCE_KEY_V1 = Buffer.alloc(32, 9).toString("hex");
process.env.EMAIL_PUBLIC_ORIGIN = "https://crm.example.test";
type DB = Awaited<ReturnType<typeof startDisposableDatabase>>;
async function ready(db: DB) {
  const sql = db.sql,
    ws = db.workspaceId,
    connectionId = randomUUID();
  await sql`insert into em_service_connections(id,workspace_id,created_by,request_id,request_fingerprint,provider,account_label,masked_secret,encrypted_secret,state,workspace_revision)
 values(${connectionId},${ws},${owner},${randomUUID()},'fixture','resend','Fixture','fixture',${sql.json(encryptEmailSecret("fixture-secret", key, `${ws}/${connectionId}/resend/1`, 1))},'checked',0)`;
  const [domain] =
    await sql`insert into em_domains(workspace_id,connection_id,name_ascii,provider_domain_id,brand_url,state,sending_state,receiving_state,paused,created_by,last_verified_at)
 values(${ws},${connectionId},'outreach.example.test',${randomUUID()},'https://example.test','provider_verified','enabled','enabled',false,${owner},${now}) returning id`;
  const [sender] =
    await sql`insert into em_senders(workspace_id,domain_id,from_name,local_part,state,hourly_limit,daily_limit)
 values(${ws},${domain.id},'SavingKC','hello','active',2,10) returning id`;
  const config = {
    audienceId: db.audienceId,
    playbookVersionId: randomUUID(),
    senderIds: [sender.id],
    mode: "draft_only",
    copyMode: "template",
    draftGenerationBudget: 0,
    steps: [
      {
        id: randomUUID(),
        delayMinCalendarDays: 0,
        delayMaxCalendarDays: 0,
        targetCalendarDay: 0,
        subject: "Test",
        bodyTemplate: "Controlled test",
      },
      {
        id: randomUUID(),
        delayMinCalendarDays: 7,
        delayMaxCalendarDays: 10,
        targetCalendarDay: 8,
        subject: "Re: Test",
        bodyTemplate: "Follow up",
      },
    ],
    timezone: "America/Chicago",
    weekdays: ["monday", "tuesday", "wednesday", "thursday", "friday"],
    startLocal: "09:00",
    endLocal: "17:00",
    dailyLimit: 10,
    hourlyLimit: 2,
    maxRecipients: 10,
    dailyCostCap: 0,
    totalCostCap: 0,
    recontactDays: 90,
    expiresAt: "2026-12-01T00:00:00Z",
    replyActions: [],
    requiredPermissionBasis: "Fabricated test",
  };
  const campaign = await executePilotCommand(
    sql,
    owner,
    {
      command: "CAM-CREATE",
      idempotencyKey: randomUUID(),
      payload: { name: "Transport test", program: "seller_outreach" },
    },
    now,
  );
  await executePilotCommand(
    sql,
    owner,
    {
      command: "CAM-SAVE",
      entityId: campaign.entityId,
      expectedRevision: 0,
      idempotencyKey: randomUUID(),
      payload: { draftConfig: config },
    },
    now,
  );
  const review = await getPilotReview(sql, owner, campaign.entityId, now);
  await executePilotCommand(
    sql,
    owner,
    {
      command: "CAM-LAUNCH",
      entityId: campaign.entityId,
      expectedRevision: review.revision,
      idempotencyKey: randomUUID(),
      payload: {
        draftHash: review.draftHash,
        audienceHash: review.audienceHash,
        estimateHash: review.estimateHash,
        readinessRunId: review.readinessRunId,
        approvedMaxRecipients: 2,
      },
    },
    now,
  );
  await sql`update em_workspaces set execution_mode='hosted',send_enabled=true,config=${sql.json({ business: { name: "SavingKC", address: "123 Test Street", primaryDomain: "example.test", timezone: "America/Chicago", programs: ["seller_outreach"], contact: "team@example.test", privacyUrl: "https://example.test/privacy" } })} where id=${ws}`;
  await sql`update em_threads set sender_id=${sender.id} where workspace_id=${ws}`;
  const intents =
    await sql`select * from em_send_intents where workspace_id=${ws} order by id`;
  await sql`update em_send_intents set state='cancelled' where id=${intents[1].id}`;
  const intent = intents[0];
  await sql.begin(async (transaction) => {
    const tx = transaction as unknown as Tx;
    const envelope = await freezeHostedEnvelope(
      {
        tx,
        now,
        member: { workspace_id: ws, auth_user_id: owner, roles: ["owner"] },
      },
      intent.thread_id,
      "Controlled test",
      "Test",
    );
    await tx`update em_send_intents set connection_id=${connectionId},provider_payload=${tx.json(envelope.payload)},provider_payload_hash=${workflowHash(envelope.payload)},provider_idempotency_key=${`email:${intent.id}`} where id=${intent.id}`;
  });
  return intent;
}
async function withDB(run: (db: DB) => Promise<void>) {
  const db = await startDisposableDatabase();
  try {
    await run(db);
  } finally {
    await db.stop();
  }
}
test("two workers send one immutable intent once and persist provider acceptance", () =>
  withDB(async (db) => {
    const intent = await ready(db);
    let sends = 0;
    const send = async () => {
      sends++;
      await new Promise((r) => setTimeout(r, 25));
      return { state: "accepted" as const, providerId: randomUUID() };
    };
    const results = await Promise.all([
      processNextDispatch(db.sql, owner, { now, send }),
      processNextDispatch(db.sql, owner, { now, send }),
    ]);
    assert.equal(sends, 1);
    assert.equal(results.filter((x) => x.state === "accepted").length, 1);
    const [saved] =
      await db.sql`select * from em_send_intents where id=${intent.id}`;
    assert.equal(saved.state, "accepted");
    assert.equal(saved.attempt_count, 1);
    const [message] =
      await db.sql`select * from em_messages where intent_id=${intent.id}`;
    assert.equal(message.transport, "resend");
    assert.equal(message.provider_email_id, saved.provider_message_id);
    assert.match(message.text_body, /Stop marketing emails:/);
  }));
test("uncertain requests remain held from automatic retry and create no sent message", () =>
  withDB(async (db) => {
    const intent = await ready(db);
    let sends = 0;
    const send = async () => {
      sends++;
      return { state: "uncertain" as const, code: "TEST_TIMEOUT" };
    };
    assert.equal(
      (await processNextDispatch(db.sql, owner, { now, send })).state,
      "uncertain",
    );
    await processNextDispatch(db.sql, owner, { now, send });
    assert.equal(sends, 1);
    assert.equal(
      (await db.sql`select id from em_messages where intent_id=${intent.id}`)
        .length,
      0,
    );
  }));
test("suppression blocks provider I/O and simulation cannot touch hosted data", () =>
  withDB(async (db) => {
    const intent = await ready(db);
    const [thread] =
      await db.sql`select address_id from em_threads where id=${intent.thread_id}`;
    await db.sql`insert into em_suppressions(workspace_id,address_id,reason,created_by) values(${db.workspaceId},${thread.address_id},'unsubscribe',${owner})`;
    let sends = 0;
    await processNextDispatch(db.sql, owner, {
      now,
      send: async () => {
        sends++;
        return { state: "accepted", providerId: randomUUID() };
      },
    });
    assert.equal(sends, 0);
    await assert.rejects(
      simulateDelivery(db.sql, owner, randomUUID(), now),
      /WORKSPACE_NOT_READY/,
    );
  }));
test("payload tampering blocks provider I/O", () =>
  withDB(async (db) => {
    const intent = await ready(db);
    await db.sql`update em_send_intents set provider_payload=jsonb_set(provider_payload,'{text}','"changed"') where id=${intent.id}`;
    let sends = 0;
    await processNextDispatch(db.sql, owner, {
      now,
      send: async () => {
        sends++;
        return { state: "accepted", providerId: randomUUID() };
      },
    });
    assert.equal(sends, 0);
    const [saved] =
      await db.sql`select state from em_send_intents where id=${intent.id}`;
    assert.equal(saved.state, "held");
  }));

import {
  reduceDeliveryEvent,
  processPendingDeliveryEvents,
} from "../../src/lib/email/inbound/delivery";
test("out-of-order delivery cannot undo delivery status and complaint suppresses every future send", () =>
  withDB(async (db) => {
    const intent = await ready(db),
      providerId = randomUUID();
    await processNextDispatch(db.sql, owner, {
      now,
      send: async () => ({ state: "accepted", providerId }),
    });
    const [saved] =
      await db.sql`select connection_id from em_send_intents where id=${intent.id}`;
    for (const type of [
      "email.delivered",
      "email.sent",
      "email.opened",
      "email.clicked",
      "email.scheduled",
      "email.complained",
      "email.delivered",
    ]) {
      await db.sql.begin(async (transaction) => {
        const tx = transaction as unknown as Tx;
        const [event] =
          await tx`insert into em_provider_events(workspace_id,connection_id,provider_event_id,type,payload_hash,provider_email_id)
    values(${db.workspaceId},${saved.connection_id},${randomUUID()},${type},'fixture',${providerId}) returning *`;
        await reduceDeliveryEvent(
          tx,
          event as Parameters<typeof reduceDeliveryEvent>[1],
          now,
        );
      });
    }
    const [result] =
      await db.sql`select remote_outcome from em_send_intents where id=${intent.id}`;
    assert.equal(result.remote_outcome, "email.complained");
    assert.equal(
      (
        await db.sql`select id from em_suppressions where workspace_id=${db.workspaceId}`
      ).length,
      1,
    );
    assert.equal(
      (
        await db.sql`select id from em_send_intents where thread_id=${intent.thread_id} and state='queued'`
      ).length,
      0,
    );
  }));
test("early webhook waits for its actual provider receipt without pausing unrelated work", () =>
  withDB(async (db) => {
    const intent = await ready(db),
      providerId = randomUUID();
    const [saved] =
      await db.sql`select connection_id from em_send_intents where id=${intent.id}`;
    await db.sql`insert into em_provider_events(workspace_id,connection_id,provider_event_id,type,payload_hash,provider_email_id,hold_reason)
 values(${db.workspaceId},${saved.connection_id},${randomUUID()},'email.delivered','fixture',${providerId},'awaiting_send_receipt')`;
    assert.equal(await processPendingDeliveryEvents(db.sql, owner, now), 0);
    await processNextDispatch(db.sql, owner, {
      now,
      send: async () => ({ state: "accepted", providerId }),
    });
    assert.equal(await processPendingDeliveryEvents(db.sql, owner, now), 1);
    const [ws] =
      await db.sql`select pause_reason from em_workspaces where id=${db.workspaceId}`;
    assert.equal(ws.pause_reason, null);
  }));

import { queueControlledTest } from "../../src/lib/email/dispatch/controlled-test";
test("controlled test is allowlisted, idempotent and excludes automatic follow-up", () =>
  withDB(async (db) => {
    await ready(db);
    process.env.EMAIL_CONTROLLED_RECIPIENT = "owner@example.test";
    const [sender] =
      await db.sql`select id from em_senders where workspace_id=${db.workspaceId}`;
    const input = { senderId: sender.id, idempotencyKey: randomUUID() };
    const [a, b] = await Promise.all([
      queueControlledTest(db.sql, owner, input, now),
      queueControlledTest(db.sql, owner, input, now),
    ]);
    assert.equal(a.entityId, b.entityId);
    await db.sql`update em_workspaces set send_enabled=false where id=${db.workspaceId}`;
    let sends = 0;
    await processNextDispatch(db.sql, owner, {
      now,
      allowlistedTest: "owner@example.test",
      send: async (_key, payload) => {
        sends++;
        assert.deepEqual(payload.to, ["owner@example.test"]);
        return { state: "accepted", providerId: randomUUID() };
      },
    });
    assert.equal(sends, 1);
    assert.equal(
      (
        await db.sql`select id from em_send_intents where thread_id=${a.threadId}`
      ).length,
      1,
    );
    const [campaign] =
      await db.sql`select c.is_test from em_campaigns c join em_threads t on t.campaign_id=c.id where t.id=${a.threadId}`;
    assert.equal(campaign.is_test, true);
  }));

import { enableTestedSending } from "../../src/lib/email/setup/readiness";
test("an owner cannot enable sending without completed live readiness evidence", () =>
  withDB(async (db) => {
    await ready(db);
    const [ws] =
      await db.sql`select revision from em_workspaces where id=${db.workspaceId}`;
    await assert.rejects(
      enableTestedSending(db.sql, owner, ws.revision),
      /READINESS_REQUIRED/,
    );
  }));
test("provider acceptance survives a follow-up preparation failure", () =>
  withDB(async (db) => {
    const intent = await ready(db);
    const providerId = randomUUID();
    const result = await processNextDispatch(db.sql, owner, {
      now,
      send: async () => {
        await db.sql`update em_workspaces set config='{}' where id=${db.workspaceId}`;
        return { state: "accepted", providerId };
      },
    });
    assert.equal(result.state, "accepted");
    const [saved] =
      await db.sql`select state,provider_message_id from em_send_intents where id=${intent.id}`;
    assert.equal(saved.state, "accepted");
    assert.equal(saved.provider_message_id, providerId);
    assert.equal(
      (await db.sql`select id from em_messages where intent_id=${intent.id}`)
        .length,
      1,
    );
    const [thread] =
      await db.sql`select state from em_threads where id=${intent.thread_id}`;
    assert.equal(thread.state, "needs_review");
  }));
test("disabled receiving after review prevents provider I/O", () =>
  withDB(async (db) => {
    const intent = await ready(db);
    await db.sql`update em_domains set receiving_state='disabled' where workspace_id=${db.workspaceId}`;
    let sends = 0;
    await processNextDispatch(db.sql, owner, {
      now,
      send: async () => {
        sends++;
        return { state: "accepted", providerId: randomUUID() };
      },
    });
    assert.equal(sends, 0);
    const [saved] =
      await db.sql`select state from em_send_intents where id=${intent.id}`;
    assert.equal(saved.state, "held");
  }));
import { queueIntent } from "../../src/lib/email/workflow/queue-intent";
import { readPilotState } from "../../src/lib/email/workflow/service";
test("uncertain delivery is visible and prevents a second provider intent", () =>
  withDB(async (db) => {
    const intent = await ready(db);
    await processNextDispatch(db.sql, owner, {
      now,
      send: async () => ({ state: "uncertain", code: "TEST_TIMEOUT" }),
    });
    const before = (
      await db.sql`select id from em_send_intents where thread_id=${intent.thread_id}`
    ).length;
    await assert.rejects(
      db.sql.begin(async (transaction) =>
        queueIntent(
          {
            tx: transaction as unknown as Tx,
            now,
            member: {
              workspace_id: db.workspaceId,
              auth_user_id: owner,
              roles: ["owner"],
            },
          },
          {
            threadId: intent.thread_id,
            key: randomUUID(),
            body: "A second send",
            subject: "Follow up",
            step: 0,
            origin: "human",
            contentRevision: 1,
            controllerRevision: 1,
            due: now,
            expires: new Date(now.getTime() + 3600000),
          },
        ),
      ),
      /DELIVERY_RECONCILIATION_REQUIRED/,
    );
    assert.equal(
      (
        await db.sql`select id from em_send_intents where thread_id=${intent.thread_id}`
      ).length,
      before,
    );
    const state = await readPilotState(db.sql, owner, now);
    assert.equal(
      state.threads.find((t) => t.id === intent.thread_id)?.sending_issue,
      "uncertain",
    );
  }));
