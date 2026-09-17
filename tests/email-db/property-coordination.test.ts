import {test} from 'node:test'
import assert from 'node:assert/strict'
import {startDisposableDatabase,fixtureOwner as owner,fixtureNow} from '../email-local/database.mjs'
import {reviewedCallback} from '../email-local/callback-fixture'
import {contactHygieneReasons} from '../../src/lib/email/hygiene/guards'
import {holdRelatedOutreach,needsPropertyReview} from '../../src/lib/email/hygiene/property'
import type {Tx} from '../../src/lib/email/workflow/core'
test('active discussion holds other heirs; broad stop requires review without unsubscribing them',async()=>{
 const db=await startDisposableDatabase(),now=new Date(fixtureNow)
 try{
  const command=await reviewedCallback(db),thread={id:command.payload.threadId}
  const [person]=await db.sql`select party_id from em_threads where id=${thread.id}`
  const [property]=await db.sql`select canonical_property_id from em_party_properties where party_id=${person.party_id}`
  const other=db.partyIds.find(id=>id!==person.party_id)!
  await db.sql`update em_party_properties set canonical_property_id=${property.canonical_property_id},relationship='heir' where party_id=${other}`
  const [address]=await db.sql`select address_id from em_selected_addresses where party_id=${other} and slot=1`
  await db.sql.begin(t=>holdRelatedOutreach({tx:t as unknown as Tx,member:{workspace_id:db.workspaceId,auth_user_id:owner,roles:['owner']},now},thread.id,'Real reply requires coordination'))
  const reasons=await db.sql.begin(t=>contactHygieneReasons(t as unknown as Tx,{workspaceId:db.workspaceId,partyId:other,addressId:address.address_id,now}))
  assert.ok(reasons.some(r=>r.includes('Property outreach held')))
  await db.sql.begin(t=>holdRelatedOutreach({tx:t as unknown as Tx,member:{workspace_id:db.workspaceId,auth_user_id:owner,roles:['owner']},now},thread.id,'Stop contacting my family',true))
  const [hold]=await db.sql`select reason from em_property_marketing_holds where canonical_property_id=${property.canonical_property_id}`;assert.equal(hold.reason,'owner_review')
  const [stops]=await db.sql`select count(*)::int as n from em_person_marketing_rules`;assert.equal(stops.n,0)
  assert.equal(needsPropertyReview('Remove me'),false)
  assert.equal(needsPropertyReview('Stop contacting my family'),true)
  assert.equal(needsPropertyReview('The owner passed away'),true)
 }finally{await db.stop()}
})
