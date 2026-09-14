import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDisposableDatabase, fixtureOwner as owner, fixtureAgent as agent, fixtureNow } from '../email-local/database.mjs'
import { reviewedCallback } from '../email-local/callback-fixture'
import { executePilotCommand } from '../../src/lib/email/workflow/service'
import { processLeadSmsAlerts } from '../../src/lib/email/notifications/sms-worker'
import { leadSmsEnabled } from '../../src/lib/email/notifications/sms-provider'
import { createLeadSmsStatusHttp } from '../../src/lib/email/notifications/sms-status'
const now = new Date(fixtureNow)
const sid = `SM${'a'.repeat(32)}`
type Db = Awaited<ReturnType<typeof startDisposableDatabase>>
async function setup(db: Db, positive = true) {
  await db.sql`update agent_profiles set phone='+18165550101' where id=${db.profileIds.agent}`
  await db.sql`update agent_profiles set phone='+18165550102' where id=${db.profileIds.owner}`
  const command = await reviewedCallback(db,'I would consider selling. Call me at 8165550199.')
  command.payload.positiveSellerInterest = positive
  command.payload.requestedContact = { phone: '8165550199' }
  const result = await executePilotCommand(db.sql,owner,command,now)
  return { ...result, threadId: command.payload.threadId }
}
function withDb(name: string, run: (db: Db) => Promise<void>) {
  test(name, async () => { const db=await startDisposableDatabase(); try {await run(db)} finally {await db.stop()} })
}
withDb('positive Lead handoff queues one owner SMS; concurrent workers submit once',async db=>{
  const h=await setup(db)
  assert.equal(h.state,'handoff_saved_crm_synced')
  const [notice]=await db.sql`select * from em_notifications where thread_id=${h.threadId} and kind='Callback task ready'`
  await db.sql`insert into em_notifications(workspace_id,thread_id,recipient_id,kind,logical_key)
    values(${notice.workspace_id},${notice.thread_id},${notice.recipient_id},${notice.kind},${randomUUID()})`
  assert.equal((await db.sql`select * from em_lead_sms_alerts`).length,1)
  let sends=0
  const send=async (input:{phone:string;body:string})=>{sends++;assert.equal(input.phone,'+18165550101');assert.match(input.body,/No time specified/);assert.match(input.body,new RegExp(`thread=${h.threadId}`));return {success:true,sid,status:'queued'}}
  await Promise.all([processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>now}),processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>now})])
  assert.equal(sends,1)
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'accepted')
})
withDb('held Lead conversion does not produce SMS',async db=>{
  await setup(db,false)
  assert.equal((await db.sql`select * from em_lead_sms_alerts`).length,0)
})
withDb('unaccepted callback alerts backup once after response window; accepting cancels escalation',async db=>{
  const h=await setup(db)
  const phones:string[]=[]
  const send=async (input:{phone:string;body:string})=>{phones.push(input.phone);return {success:true,sid:`SM${String(phones.length).repeat(32)}`}}
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>now})
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>new Date(now.getTime()+10*60_000)})
  assert.equal(phones.length,1)
  const later=new Date(now.getTime()+31*60_000)
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>later})
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>later})
  assert.deepEqual(phones,['+18165550101','+18165550102'])
  assert.equal((await db.sql`select state from em_handoffs where id=${h.entityId}`)[0].state,'needs_contact')
})
withDb('accepted callbacks, revoked memberships and changed owners cannot send queued alerts',async db=>{
  const h=await setup(db)
  const send=async()=>{throw new Error('must not send')}
  await db.sql`update em_handoffs set state='acknowledged' where id=${h.entityId}`
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>now})
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'cancelled')
  await db.sql`update em_handoffs set state='needs_contact' where id=${h.entityId}`
  await db.sql`update em_lead_sms_alerts set state='queued'`
  await db.sql`update em_memberships set active=false where auth_user_id=${agent}`
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>now})
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'cancelled')
  await db.sql`update em_memberships set active=true where auth_user_id=${agent}`
  await db.sql`update em_lead_sms_alerts set state='queued'`
  await db.sql`update leads set assigned_agent='Another agent' where id=(select lead_id from em_handoffs where id=${h.entityId})`
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>now})
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'cancelled')
})
withDb('unknown provider result is held without resend and creates an operator alert',async db=>{
  await setup(db)
  let sends=0
  const send=async()=>{sends++;throw new Error('timeout')}
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>now})
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>new Date(now.getTime()+60_000)})
  assert.equal(sends,1)
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'unknown')
  assert.ok((await db.sql`select id from em_notifications where recipient_id=${owner} and kind like '%delivery unknown%'`).length)
})
withDb('Twilio receipt validates signature, phone and SID and cannot downgrade delivered',async db=>{
  await setup(db)
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send:async()=>({success:true,sid}),now:()=>now})
  const [a]=await db.sql`select * from em_lead_sms_alerts`
  const request=(status:string,phone='+18165550101')=>new Request(`https://crm.savingkc.com/api/webhooks/email/lead-sms?id=${a.id}`,{
    method:'POST',body:new URLSearchParams({MessageSid:sid,MessageStatus:status,To:phone})})
  const denied=createLeadSmsStatusHttp({database:()=>db.sql,validate:async()=>false})
  assert.equal((await denied(request('delivered'))).status,403)
  const handler=createLeadSmsStatusHttp({database:()=>db.sql,validate:async()=>true})
  assert.equal((await handler(request('delivered','+18165550999'))).status,204)
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'accepted')
  await handler(request('delivered'))
  await handler(request('sent'))
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'delivered')
})
withDb('acknowledged owner notification prevents backup SMS',async db=>{
  await setup(db)
  let sends=0
  const send=async()=>{sends++;return {success:true,sid}}
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>now})
  await db.sql`update em_notifications set acknowledged_at=${now} where kind='Callback task ready'`
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send,now:()=>new Date(now.getTime()+31*60_000)})
  assert.equal(sends,1)
})

withDb('missing agent phone fails visibly and never calls the provider', async db => {
  await setup(db)
  await db.sql`update agent_profiles set phone=null where id=${db.profileIds.agent}`
  let sends=0
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,send:async()=>{sends++;return {success:true,sid}},now:()=>now})
  assert.equal(sends,0)
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'failed')
  assert.ok((await db.sql`select id from em_notifications where recipient_id=${owner} and kind like '%phone needs review%'`).length)
})
withDb('delivery failure is visible to owner and recipient; early delivered receipt survives submit result', async db => {
  await setup(db)
  const handler=createLeadSmsStatusHttp({database:()=>db.sql,validate:async()=>true})
  const receipt=(id:string,status:string,receiptSid=sid)=>new Request(`https://crm.savingkc.com/api/webhooks/email/lead-sms?id=${id}`,{
    method:'POST',body:new URLSearchParams({MessageSid:receiptSid,MessageStatus:status,To:'+18165550101',ErrorCode:'30003'})})
  await processLeadSmsAlerts(db.sql,owner,{enabled:true,now:()=>now,send:async input=>{
    assert.equal((await handler(receipt(input.id,'delivered'))).status,204)
    return {success:true,sid,status:'queued'}
  }})
  const [a]=await db.sql`select * from em_lead_sms_alerts`
  assert.equal(a.state,'delivered')
  await db.sql`update em_lead_sms_alerts set state='accepted',delivered_at=null where id=${a.id}`
  await handler(receipt(a.id,'failed',`SM${'b'.repeat(32)}`))
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'accepted')
  await handler(receipt(a.id,'undelivered'))
  assert.equal((await db.sql`select state from em_lead_sms_alerts`)[0].state,'failed')
  assert.equal((await db.sql`select id from em_notifications where kind='Lead SMS failed — review delivery'`).length,2)
})
test('SMS requires explicit hosted enablement and cannot send from preview or test mode', () => {
  const keys=['EMAIL_LEAD_SMS_ENABLED','EMAIL_WORKFLOW_MODE','NODE_ENV','VERCEL_ENV','TEST_MODE']
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]))
  try {
    Object.assign(process.env,{EMAIL_LEAD_SMS_ENABLED:'true',EMAIL_WORKFLOW_MODE:'hosted',NODE_ENV:'production',VERCEL_ENV:'production',TEST_MODE:'false'})
    assert.equal(leadSmsEnabled(),true)
    process.env.VERCEL_ENV='preview';assert.equal(leadSmsEnabled(),false)
    process.env.VERCEL_ENV='production';process.env.TEST_MODE='true';assert.equal(leadSmsEnabled(),false)
    process.env.TEST_MODE='false';process.env.EMAIL_WORKFLOW_MODE='local';assert.equal(leadSmsEnabled(),false)
    process.env.EMAIL_WORKFLOW_MODE='hosted';process.env.EMAIL_LEAD_SMS_ENABLED='false';assert.equal(leadSmsEnabled(),false)
  } finally {for(const key of keys){if(old[key]===undefined) delete process.env[key];else process.env[key]=old[key]}}
})
