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
export const fixtureOwnerProfile = '10000000-0000-4000-8000-000000000001'
export const fixtureAgentProfile = '10000000-0000-4000-8000-000000000002'
export const fixtureReaderProfile = '10000000-0000-4000-8000-000000000003'
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
      create schema auth;
      create table auth.users(id uuid primary key,email text not null unique);
      create table agent_profiles(id uuid primary key,email text not null unique,full_name text,phone text,is_admin boolean,role text,is_active boolean default true,user_id uuid);`)
    await sql`insert into auth.users(id,email) values
      (${fixtureOwner},'owner@savingkc.test'),
      (${fixtureAgent},'agent@savingkc.test'),
      (${fixtureReader},'reader@savingkc.test')`
    await sql`insert into agent_profiles(id,email,full_name,is_admin,role) values
      (${fixtureOwnerProfile},'owner@savingkc.test','Demo owner',true,'owner'),
      (${fixtureAgentProfile},'agent@savingkc.test','Demo agent',false,'agent'),
      (${fixtureReaderProfile},'reader@savingkc.test','Demo reader',false,'agent')`
    await sql.unsafe(
      await readFile(
        path.join(root, 'tests/email-local/crm-fixture.sql'),
        'utf8',
      ),
    )
    await sql.unsafe(
      await readFile(
        path.join(
          root,
          'supabase/migrations/20260823120000_crm_entity_foundation.sql',
        ),
        'utf8',
      ),
    )
    for (const name of [
      '20260912130000_email_configuration.sql',
      '20260912140000_email_identity.sql',
      '20260912150000_email_campaigns.sql',
      '20260912160000_email_execution.sql',
      '20260912170000_email_local_workflow.sql',
      '20260912180000_email_crm_bridge.sql',
      '20260912181000_email_crm_identity_guard.sql',
      '20260912182000_email_crm_projection_repairs.sql',
      '20260914163000_email_crm_identity_locks.sql',
      '20260914190000_email_lead_sms_alerts.sql',
      '20261109130000_email_lead_sms_alert_cycles.sql',
      '20260913010000_email_action_workspace.sql',
      '20260913020000_email_ai_generations.sql',
      '20260913030000_email_service_connections.sql',
      '20260913040000_email_sender_domains.sql',
      '20260913140000_email_webhook_capture.sql',
      '20260913150000_email_received_content.sql',
      '20260913160000_email_public_unsubscribe.sql',
      '20260913220000_email_hosted_dispatch.sql',
      '20261110120000_email_person_property_hygiene.sql',
      '20261110121000_email_hygiene_runtime_access.sql',
      '20261110122000_email_reply_message_ids.sql',
      '20261110123000_email_related_contacts.sql',
    ]) {
      await sql.unsafe(
        await readFile(path.join(root, 'supabase/migrations', name), 'utf8'),
      )
    }
    const [workspace] =
      await sql`update em_workspaces set execution_mode='simulation' returning id`
    for (const [authUserId, profileId, role] of [
      [fixtureAgent, fixtureAgentProfile, 'acquisitions'],
      [fixtureReader, fixtureReaderProfile, 'reader'],
    ]) {
      await sql`insert into em_memberships(workspace_id,auth_user_id,agent_profile_id,roles) values(${workspace.id},${authUserId},${profileId},${[role]})`
    }
    const [audience] =
      await sql`insert into em_audiences(workspace_id,name,program,state) values(${workspace.id},'Local practice recipients','seller_outreach','ready') returning id`
    const [snapshot] =
      await sql`insert into em_audience_snapshots(workspace_id,audience_id,source_revision,content_hash,row_count,eligible_count)
      values(${workspace.id},${audience.id},1,'fabricated-fixture-v1',3,2) returning id`
    const partyIds = []
    const canonicalPeople = []
    const canonicalProperties = []
    for (const [index, [name, email, verification]] of [
      ['Jamie Sample', 'jamie@example.test', 'valid'],
      ['Morgan Sample', 'morgan@example.test', 'valid'],
      ['Taylor Sample', 'taylor@example.test', 'unknown'],
    ].entries()) {
      const propertyAddress = `${101 + index} Fixture Avenue`
      const parcelId = `fixture-parcel-${index + 1}`
      const [person] =
        await sql`insert into crm_people(display_name) values(${name}) returning id`
      await sql`insert into crm_contact_methods(
          person_id,method_type,raw_value,normalized_value,is_primary,
          deliverability_status,sms_consent_status
        ) values(
          ${person.id},'email',${email},${email},true,${verification},
          'not_applicable'
        )`
      const [canonicalProperty] = await sql`insert into crm_properties(
          normalized_address,address,city,state,zip,county,parcel_id,
          property_type,bedrooms,bathrooms,sqft,year_built
        ) values(
          normalize_crm_address(${propertyAddress},'Kansas City','MO','64111'),
          ${propertyAddress},'Kansas City','MO','64111','Jackson',${parcelId},
          'single_family',3,2,1400,1950
        ) returning id`
      const [party] = await sql`insert into em_parties(
          workspace_id,display_name,kind,identity_state,canonical_person_id,
          identity_evidence
        ) values(
          ${workspace.id},${name},'seller','confirmed',${person.id},
          '{"source":"fabricated local fixture"}'::jsonb
        ) returning id`
      const [address] =
        await sql`insert into em_addresses(workspace_id,raw_address,normalized_address,verification_state,verification_expires_at)
        values(${workspace.id},${email},${email},${verification},'2027-01-01') returning id`
      await sql`insert into em_party_addresses(workspace_id,party_id,address_id,relationship,confirmed_at,evidence)
        values(${workspace.id},${party.id},${address.id},'confirmed',${fixtureNow},' {"source":"fabricated local fixture"}'::jsonb)`
      await sql`insert into em_snapshot_rows(workspace_id,snapshot_id,party_id,address_id,eligibility,evidence_hash)
        values(${workspace.id},${snapshot.id},${party.id},${address.id},'eligible','fixture-only-not-real-verification')`
      await sql`insert into em_party_properties(
          workspace_id,party_id,canonical_property_id,parcel_id,county,address,
          relationship,evidence
        ) values(
          ${workspace.id},${party.id},${canonicalProperty.id},${parcelId},
          'Jackson',${propertyAddress},'owner',
          '{"source":"fabricated local fixture"}'::jsonb
        )`
      await sql`insert into em_selected_addresses(workspace_id,party_id,address_id,slot) values(${workspace.id},${party.id},${address.id},1)`
      partyIds.push(party.id)
      canonicalPeople.push(person.id)
      canonicalProperties.push(canonicalProperty.id)
    }
    return {
      url,
      sql,
      workspaceId: workspace.id,
      audienceId: audience.id,
      partyIds,
      canonicalPeople,
      canonicalProperties,
      profileIds: {
        owner: fixtureOwnerProfile,
        agent: fixtureAgentProfile,
        reader: fixtureReaderProfile,
      },
      stop,
    }
  } catch (error) {
    await stop()
    throw error
  }
}
