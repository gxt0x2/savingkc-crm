import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {startDisposableDatabase} from '../email-local/database.mjs'
test('new hygiene tables permit the existing hosted backend role, never browser roles',async()=>{
 const db=await startDisposableDatabase()
 try{
  await db.sql.unsafe('create role email_workflow_runtime bypassrls')
  const migration=await readFile(new URL('../../supabase/migrations/20261110121000_email_hygiene_runtime_access.sql',import.meta.url),'utf8')
  await db.sql.unsafe(migration);await db.sql.unsafe(migration)
  for(const table of ['em_person_marketing_rules','em_property_marketing_holds','em_selected_addresses']){
   const [access]=await db.sql`select has_table_privilege('email_workflow_runtime',${'public.'+table},'select,insert,update,delete') as backend,has_table_privilege('anon',${'public.'+table},'select') as anonymous,has_table_privilege('authenticated',${'public.'+table},'select') as browser`
   assert.equal(access.backend,true);assert.equal(access.anonymous,false);assert.equal(access.browser,false)
  }
  await db.sql.begin(async tx=>{await tx.unsafe('set local role email_workflow_runtime');assert.equal((await tx`select * from em_selected_addresses`).length,db.partyIds.length)})
 }finally{await db.stop()}
})
