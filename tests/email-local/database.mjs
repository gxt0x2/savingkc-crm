import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import net from 'node:net'
import postgres from 'postgres'

export const fixtureOwner = '00000000-0000-4000-8000-000000000001'
export const fixtureAgent = '00000000-0000-4000-8000-000000000002'
export const fixtureReader = '00000000-0000-4000-8000-000000000003'
export const fixtureNow = '2026-09-14T15:00:00.000Z'
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolve(port))
    })
  })
}

export async function startDisposableDatabase() {
  const directory = await mkdtemp(path.join(tmpdir(), 'savingkc-email-test-'))
  const bin =
    process.env.EMAIL_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@16/bin'
  const port = await freePort()
  let started = false,
    sql
  async function stop() {
    if (sql) await sql.end({ timeout: 2 })
    if (started)
      execFileSync(
        path.join(bin, 'pg_ctl'),
        ['-D', directory, '-m', 'immediate', '-w', 'stop'],
        { stdio: 'ignore' },
      )
    await rm(directory, { recursive: true, force: true })
  }
  try {
    execFileSync(
      path.join(bin, 'initdb'),
      [
        '-D',
        directory,
        '-U',
        'email_fixture',
        '-A',
        'trust',
        '--no-locale',
        '-E',
        'UTF8',
      ],
      { stdio: 'ignore' },
    )
    execFileSync(
      path.join(bin, 'pg_ctl'),
      [
        '-D',
        directory,
        '-l',
        path.join(directory, 'server.log'),
        '-o',
        `-h 127.0.0.1 -p ${port} -k ${directory}`,
        '-w',
        'start',
      ],
      { stdio: 'ignore' },
    )
    started = true
    const admin = postgres(
      `postgres://email_fixture@127.0.0.1:${port}/postgres`,
      { max: 1 },
    )
    await admin.unsafe('create database email_test_workflow')
    await admin.end()
    const url = `postgres://email_fixture@127.0.0.1:${port}/email_test_workflow`
    sql = postgres(url, { max: 6, prepare: false, onnotice: () => {} })
    await sql.unsafe(`create role anon; create role authenticated; create role service_role bypassrls;
      create table agent_profiles(id uuid primary key,user_id uuid,name text,is_active boolean,is_admin boolean,role text);
      create table crm_people(id uuid primary key); create table crm_properties(id uuid primary key); create table leads(id uuid primary key);`)
    await sql`insert into agent_profiles(id,user_id,name,is_active,is_admin,role) values
      (${fixtureOwner},${fixtureOwner},'Demo owner',true,true,'owner'),
      (${fixtureAgent},${fixtureAgent},'Demo agent',true,false,'agent'),
      (${fixtureReader},${fixtureReader},'Demo reader',true,false,'agent')`
    for (const name of [
      '20260912130000_email_configuration.sql',
      '20260912140000_email_identity.sql',
      '20260912150000_email_campaigns.sql',
      '20260912160000_email_execution.sql',
      '20260912170000_email_local_workflow.sql',
    ]) {
      await sql.unsafe(
        await readFile(path.join(root, 'supabase/migrations', name), 'utf8'),
      )
    }
    const [workspace] =
      await sql`update em_workspaces set execution_mode='simulation' returning id`
    for (const [id, role] of [
      [fixtureAgent, 'acquisitions'],
      [fixtureReader, 'reader'],
    ]) {
      await sql`insert into em_memberships(workspace_id,auth_user_id,agent_profile_id,roles) values(${workspace.id},${id},${id},${[role]})`
    }
    const [audience] =
      await sql`insert into em_audiences(workspace_id,name,program,state) values(${workspace.id},'Local practice recipients','seller_outreach','ready') returning id`
    const [snapshot] =
      await sql`insert into em_audience_snapshots(workspace_id,audience_id,source_revision,content_hash,row_count,eligible_count)
      values(${workspace.id},${audience.id},1,'fabricated-fixture-v1',3,2) returning id`
    for (const [name, email, verification] of [
      ['Jamie Sample', 'jamie@example.test', 'valid'],
      ['Morgan Sample', 'morgan@example.test', 'valid'],
      ['Taylor Sample', 'taylor@example.test', 'unknown'],
    ]) {
      const [party] =
        await sql`insert into em_parties(workspace_id,display_name,kind,identity_state) values(${workspace.id},${name},'seller','confirmed') returning id`
      const [address] =
        await sql`insert into em_addresses(workspace_id,raw_address,normalized_address,verification_state,verification_expires_at)
        values(${workspace.id},${email},${email},${verification},'2027-01-01') returning id`
      await sql`insert into em_party_addresses(workspace_id,party_id,address_id,relationship,confirmed_at,evidence)
        values(${workspace.id},${party.id},${address.id},'confirmed',${fixtureNow},' {"source":"fabricated local fixture"}'::jsonb)`
      await sql`insert into em_snapshot_rows(workspace_id,snapshot_id,party_id,address_id,eligibility,evidence_hash)
        values(${workspace.id},${snapshot.id},${party.id},${address.id},'eligible','fixture-only-not-real-verification')`
    }
    return {
      url,
      sql,
      workspaceId: workspace.id,
      audienceId: audience.id,
      stop,
    }
  } catch (error) {
    await stop()
    throw error
  }
}
