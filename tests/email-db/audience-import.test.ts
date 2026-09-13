import { test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { startDisposableDatabase, fixtureOwner as owner, fixtureReader as reader,fixtureNow } from '../email-local/database.mjs'
import { importAudience } from '../../src/lib/email/audiences/import'
const now=new Date(fixtureNow)
test('imports evidence idempotently, preserves stops and excludes unknown identities',async()=>{
 const db=await startDisposableDatabase()
 try{
  const input={name:'Reviewed CRM list',idempotencyKey:randomUUID(),source:'Verification report',permissionBasis:'Owner reviewed source and outreach eligibility',rows:[
   {name:'Jamie',email:'jamie@example.test',verificationStatus:'valid',verifiedAt:now.toISOString(),verificationSource:'report-1'},
   {name:'Unknown',email:'unknown@example.test',verificationStatus:'valid',verifiedAt:now.toISOString(),verificationSource:'report-1'},
   {name:'Jamie',email:'jamie@example.test',verificationStatus:'valid',verifiedAt:now.toISOString(),verificationSource:'report-1'},
  ]}
  await assert.rejects(importAudience(db.sql,reader,input,now),/FORBIDDEN/)
  const first=await importAudience(db.sql,owner,input,now),again=await importAudience(db.sql,owner,input,now)
  assert.deepEqual(first,again);assert.equal(first.eligible,1);assert.equal(first.review,1);assert.equal(first.duplicates,1)
  const [address]=await db.sql`select id from em_addresses where normalized_address='jamie@example.test'`
  await db.sql`insert into em_suppressions(workspace_id,address_id,reason,created_by) values(${db.workspaceId},${address.id},'unsubscribe',${owner})`
  const stopped=await importAudience(db.sql,owner,{...input,idempotencyKey:randomUUID()},now)
  assert.equal(stopped.eligible,0)
  const [count]=await db.sql`select count(*)::int as n from em_suppressions where address_id=${address.id}`;assert.equal(count.n,1)
 }finally{await db.stop()}
})
test('verification without current report evidence is not accepted',async()=>{
 const db=await startDisposableDatabase()
 try{
  const result=await importAudience(db.sql,owner,{name:'Unverified',idempotencyKey:randomUUID(),source:'CRM export',permissionBasis:'Owner reviewed source but no verification report',rows:[{name:'Jamie',email:'jamie@example.test',verificationStatus:'valid'}]},now)
  assert.equal(result.eligible,0)
 }finally{await db.stop()}
})
