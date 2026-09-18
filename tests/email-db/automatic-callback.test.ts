import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reviewedCallback } from '../email-local/callback-fixture'
import { startDisposableDatabase, fixtureOwner as owner, fixtureAgent as agent, fixtureNow } from '../email-local/database.mjs'
import { automaticallyHandoffCallback, automaticCallbackRequest } from '../../src/lib/email/inbound/automatic-callback'
import type { Tx } from '../../src/lib/email/workflow/core'
import { createHmac, randomUUID } from 'node:crypto'
import { connectService } from '../../src/lib/email/connections/service'
import { createResendWebhookHttp, webhookSecretAad } from '../../src/lib/email/inbound/capture'
import { encryptEmailSecret } from '../../src/lib/email/secrets'
import { processNextReceivedReply } from '../../src/lib/email/inbound/worker'

const now = new Date(fixtureNow)
test('automatic eligibility requires unambiguous first-person callback instructions', () => {
  assert.ok(automaticCallbackRequest('Call me at 9137179716'))
  assert.ok(automaticCallbackRequest('Please call me at 913-717-9716 tomorrow afternoon.'))
  assert.equal(automaticCallbackRequest('Call me at 9137179716 about your car warranty.'),null)
  for (const text of ['9137179716', 'If interested call me at 9137179716', 'Do not call me at 9137179716', 'Call me at 9137179716?', 'Call me at 9137179716 or 8162345678', 'Call me at 9137179716 — test only', 'Call me at 9137179716 but not about selling', 'Call me at 9137179716 to remove me', 'Call me at 9131119716', 'My brother says call me at 9137179716']) {
    assert.equal(automaticCallbackRequest(text), null, text)
  }
})
for (const mode of ['success', 'relative', 'heir', 'identity', 'suppressed', 'pending', 'test'] as const) {
  test(`automatic callback ${mode} preserves routing and duplicate boundaries`, async () => {
    const db = await startDisposableDatabase()
    try {
      const command = await reviewedCallback(db, 'Call me at 9137179716', mode === 'test' ? 'Controlled setup test' : 'Pilot')
      const threadId = command.payload.threadId
      const messageId = command.payload.factEvidence[0].messageId
      const [ws] = await db.sql`select id,config from em_workspaces limit 1`
      await db.sql`update em_workspaces set config=jsonb_set(config,'{team}',${db.sql.json({ reviewerId: owner, acquisitionOwnerId: agent, backupId: owner, hours: { timezone:'America/Chicago', weekdays:['monday','tuesday','wednesday','thursday','friday'],startLocal:'09:00',endLocal:'17:00' },sla:{urgentMinutes:30,ordinaryMinutes:60},calendarMode:'manual' })}) where id=${ws.id}`
      if (mode === 'relative' || mode === 'heir') await db.sql`update em_party_properties set relationship=${mode} where party_id=(select party_id from em_threads where id=${threadId})`
      if (mode === 'identity') await db.sql`update em_parties set identity_state='unresolved' where id=(select party_id from em_threads where id=${threadId})`
      if (mode === 'suppressed') await db.sql`update em_threads set state='stopped' where id=${threadId}`
      if (mode === 'pending') await db.sql`update em_threads set inbound_pending=true where id=${threadId}`
      const run = () => db.sql.begin(async transaction => {
        const tx = transaction as unknown as Tx
        await tx`select id from em_workspaces where id=${ws.id} for update`
        return automaticallyHandoffCallback({tx,member:{workspace_id:ws.id,auth_user_id:owner,roles:['owner']},now},threadId,messageId)
      })
      const result = await run()
      if (mode === 'success' || mode === 'relative' || mode === 'heir') {
        assert.equal(result,true)
        assert.equal(await run(),false)
        const [lead] = await db.sql`select * from leads`
        assert.equal(lead.classification,'lead')
        assert.equal(lead.station,'contacted')
        assert.equal(lead.phone,'+19137179716')
        assert.equal((await db.sql`select * from work_items`).length,1)
        const alerts = await db.sql`select recipient_id from em_lead_sms_alerts`
        assert.equal(alerts.length,1)
        assert.equal(alerts[0].recipient_id,agent)
        const [handoff] = await db.sql`select * from em_handoffs`
        assert.equal(handoff.requested_contact.phone,'9137179716')
        assert.equal(handoff.requested_contact.requestedTimeText,undefined)
      } else {
        assert.equal((await db.sql`select * from leads`).length,0)
        assert.equal((await db.sql`select * from em_lead_sms_alerts`).length,0)
        if (mode === 'identity') assert.equal((await db.sql`select crm_sync_reason from em_handoffs`)[0].crm_sync_reason,'identity_unconfirmed')
      }
    } finally { await db.stop() }
  })
}

for (const automaticReply of [false, true]) {
  test(`signed receiving worker routes a callback only from a person (auto reply: ${automaticReply})`, async () => {
    const db = await startDisposableDatabase()
    try {
      const seed = await reviewedCallback(db)
      const threadId = seed.payload.threadId
      const [thread] = await db.sql`select t.*,a.normalized_address from em_threads t join em_addresses a on a.id=t.address_id where t.id=${threadId}`
      const [ws] = await db.sql`select id,revision from em_workspaces limit 1`
      await db.sql`update em_workspaces set config=jsonb_set(config,'{team}',${db.sql.json({ reviewerId:owner,acquisitionOwnerId:agent,backupId:owner,hours:{timezone:'America/Chicago',weekdays:['monday','tuesday','wednesday','thursday','friday'],startLocal:'09:00',endLocal:'17:00'},sla:{urgentMinutes:30,ordinaryMinutes:60},calendarMode:'manual' })}) where id=${ws.id}`
      const key = Buffer.alloc(32,7), secret = `whsec_${Buffer.alloc(32,9).toString('base64')}`
      const connected = await connectService(db.sql,owner,{provider:'resend',kind:'email',secret:'re_fixture_receiving_123456789',expectedRevision:ws.revision,accountLabel:'Receiving fixture',idempotencyKey:randomUUID()},async()=>({domainsRead:true,receivingRead:true,sendingVerified:false}),key,now)
      const endpoint = randomUUID()
      await db.sql`insert into em_webhook_endpoints(id,workspace_id,connection_id,encrypted_secret,active) values(${endpoint},${ws.id},${connected.connectionId},${db.sql.json({...encryptEmailSecret(secret,key,webhookSecretAad(ws.id,endpoint),1)})},true)`
      await db.sql`insert into em_reply_aliases(workspace_id,connection_id,thread_id,address) values(${ws.id},${connected.connectionId},${threadId},'reply-token@outreach.test')`
      const content = {id:randomUUID(),from:thread.normalized_address,to:['reply-token@outreach.test'],created_at:now.toISOString(),subject:'Re: property',message_id:`<${randomUUID()}@example.test>`,text:'Call me at 9137179716',headers:automaticReply ? {'auto-submitted':'auto-replied'} : {},attachments:[]}
      const handler = createResendWebhookHttp({database:()=>db.sql,endpointId:()=>endpoint,key:()=>key})
      for (let delivery=0; delivery<2; delivery++) {
        const body=JSON.stringify({type:'email.received',created_at:now.toISOString(),data:{email_id:content.id,from:content.from,to:content.to,message_id:content.message_id}})
        const id=`msg_${randomUUID()}`,timestamp=Math.floor(Date.now()/1000).toString()
        const signature=`v1,${createHmac('sha256',Buffer.from(secret.slice(6),'base64')).update(`${id}.${timestamp}.${body}`).digest('base64')}`
        assert.equal((await handler(new Request('http://localhost/api/webhooks/email/resend',{method:'POST',headers:{'svix-id':id,'svix-timestamp':timestamp,'svix-signature':signature},body}))).status,200)
        await db.sql`update em_jobs set run_after=${now} where dedupe_key=${`resend:${connected.connectionId}:${id}`}`
        const result = await processNextReceivedReply(db.sql,owner,{get:async()=>content},()=>now,key)
        assert.equal(result.state,delivery === 0 ? 'received' : 'already_received')
      }
      assert.equal((await db.sql`select * from leads`).length,automaticReply ? 0 : 1)
      assert.equal((await db.sql`select * from em_lead_sms_alerts`).length,automaticReply ? 0 : 1)
      assert.equal((await db.sql`select * from em_messages where transport='resend'`).length,1)
    } finally { await db.stop() }
  })
}
