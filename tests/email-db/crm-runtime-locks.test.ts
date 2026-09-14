import { test } from 'node:test'
import assert from 'node:assert/strict'
import { startDisposableDatabase } from '../email-local/database.mjs'

test('runtime locks confirmed CRM identity without canonical write privileges', async () => {
  const db = await startDisposableDatabase()
  try {
    await db.sql.unsafe(`create role email_lock_test;
      grant usage on schema public to email_lock_test;
      grant select on crm_people,crm_properties,crm_contact_methods to email_lock_test;
      grant execute on function lock_email_crm_identity(uuid,uuid) to email_lock_test;`)
    await db.sql.begin(async tx => {
      await tx.unsafe('set local role email_lock_test')
      const [privileges] = await tx`select has_table_privilege(current_user,'crm_properties','UPDATE') as can_update,
        has_table_privilege(current_user,'crm_people','UPDATE') as can_update_person`
      assert.equal(privileges.can_update, false)
      assert.equal(privileges.can_update_person, false)
      await tx`select lock_email_crm_identity(${db.workspaceId}::uuid,${db.partyIds[0]}::uuid)`
      const [locks] = await tx`select count(*)::int as n from pg_locks where pid=pg_backend_pid()
        and relation in ('crm_people'::regclass,'crm_properties'::regclass,'crm_contact_methods'::regclass)
        and mode='RowShareLock' and granted`
      assert.equal(locks.n, 3)
    })
    const [unknown] = await db.sql`select email_crm_assignee_name('casey@other.example','Casey Else') as name`
    assert.equal(unknown.name, 'Casey Else')
  } finally { await db.stop() }
})
