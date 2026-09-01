import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const controllerMigration = readFileSync(
  'supabase/migrations/20261026120000_dialer_session_control_lease.sql',
  'utf8',
)
const operationMigration = readFileSync(
  'supabase/migrations/20261026123000_dialer_session_control_operations.sql',
  'utf8',
)
const migration = `${controllerMigration}\n${operationMigration}`

describe('dialer session browser control lease migration', () => {
  it('stores only a hashed controller identity with a bounded renewable lease', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS controller_token_hash text')
    expect(migration).toContain("extensions.digest(trim(p_controller_token), 'sha256')")
    expect(migration).toContain("controller_lease_expires_at = now() + interval '45 seconds'")
    const publicControlJson = operationMigration.slice(
      operationMigration.indexOf('CREATE OR REPLACE FUNCTION public.dialer_session_control_json_v1'),
      operationMigration.indexOf('CREATE OR REPLACE FUNCTION public.claim_dialer_session_control_v1'),
    )
    expect(publicControlJson).not.toContain("'controllerToken'")
    expect(publicControlJson).not.toContain("'controllerTokenHash'")
    expect(publicControlJson).not.toContain("'operationId'")
  })

  it('serializes takeover by actor and session and rejects stale confirmation races', () => {
    expect(migration).toContain("pg_catalog.hashtextextended('dialer-actor:' || actor_key, 0)")
    expect(migration).toMatch(/claim_dialer_session_control_v1[\s\S]*WHERE id = p_session_id[\s\S]*FOR UPDATE/)
    expect(migration).toContain('p_expected_generation IS DISTINCT FROM session_row.controller_generation')
    expect(migration).toContain("RAISE EXCEPTION 'session_control_changed'")
    expect(migration).toContain('controller_generation = controller_generation + 1')
  })

  it('never transfers control during a live call or while an outcome is required', () => {
    expect(migration).toContain("status = 'awaiting_disposition'")
    expect(migration).toContain("RAISE EXCEPTION 'session_takeover_disposition_required'")
    expect(migration).toContain("status IN ('authorized', 'dialing', 'connected')")
    expect(migration).toContain("RAISE EXCEPTION 'session_takeover_live_call'")
  })

  it('recovers only an expired pre-call authorization after the controller dies', () => {
    const claimStart = operationMigration.indexOf('CREATE OR REPLACE FUNCTION public.claim_dialer_session_control_v1')
    const claim = operationMigration.slice(claimStart, operationMigration.indexOf('$$;', claimStart) + 3)

    expect(claim).toMatch(/IF p_force[\s\S]*controller_lease_expires_at <= now\(\)/)
    expect(claim).toMatch(/status = 'authorized'[\s\S]*started_at IS NULL[\s\S]*connected_at IS NULL/)
    expect(claim).toMatch(/provider_call_sid IS NULL[\s\S]*recording_sid IS NULL[\s\S]*metadata ->> 'provider_status'[\s\S]*metadata ->> 'provider_child_call_sid'/)
    expect(claim).toContain("updated_at <= now() - interval '2 minutes'")
    expect(claim).toMatch(/SET status = 'cancelled'[\s\S]*'recovery_reason', 'stale_pre_call_authorization'/)
    expect(claim).toContain("'attempt_recovered_after_controller_loss'")

    const recovery = claim.slice(
      claim.indexOf('-- Authorization is persisted'),
      claim.indexOf("status = 'awaiting_disposition'"),
    )
    expect(recovery).not.toMatch(/status\s*=\s*'(dialing|connected)'/)
  })

  it('serializes signed provider callbacks with takeover and records provider evidence', () => {
    const providerStart = operationMigration.indexOf('CREATE OR REPLACE FUNCTION public.record_dialer_attempt_provider_status_v1')
    const provider = operationMigration.slice(providerStart, operationMigration.indexOf('$$;', providerStart) + 3)
    const sessionLock = provider.indexOf('FROM public.dialer_sessions\n  WHERE id = attempt_session_id\n  FOR UPDATE')
    const attemptLock = provider.indexOf("AND client_attempt_id = trim(p_client_attempt_id)\n  FOR UPDATE")

    expect(providerStart).toBeGreaterThan(-1)
    expect(sessionLock).toBeGreaterThan(-1)
    expect(attemptLock).toBeGreaterThan(sessionLock)
    expect(provider).toContain("'provider_child_call_sid', trim(p_provider_call_sid)")
    expect(provider).toContain("'provider_status', provider_status")
    expect(provider).toMatch(/provider_status IN \('initiated', 'ringing'\)[\s\S]*next_status := 'dialing'/)
    expect(provider).toMatch(/provider_status IN \('answered', 'in-progress'\)[\s\S]*next_status := 'connected'/)
    expect(provider).toMatch(/provider_status IN \('completed', 'failed', 'canceled', 'busy', 'no-answer'\)[\s\S]*next_status := 'awaiting_disposition'/)
    expect(operationMigration).toMatch(/REVOKE ALL ON FUNCTION public\.record_dialer_attempt_provider_status_v1\([\s\S]*?FROM PUBLIC, anon, authenticated/)
    expect(operationMigration).toMatch(/GRANT EXECUTE ON FUNCTION public\.record_dialer_attempt_provider_status_v1\([\s\S]*?TO service_role/)
  })

  it('holds takeover while a bounded CRM operation is active', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS controller_operation_id uuid')
    const claimStart = operationMigration.indexOf('CREATE OR REPLACE FUNCTION public.claim_dialer_session_control_v1')
    const claim = operationMigration.slice(claimStart, operationMigration.indexOf('$$;', claimStart) + 3)
    expect(claim).toMatch(/controller_operation_expires_at > now\(\)[\s\S]*RAISE EXCEPTION 'session_takeover_operation_in_progress'/)

    for (const signature of [
      'begin_dialer_session_control_operation_v1',
      'assert_dialer_session_control_operation_v1',
      'end_dialer_session_control_operation_v1',
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${signature}`)
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated`))
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}\\([\\s\\S]*?TO service_role`))
    }
    expect(migration).toContain("controller_operation_expires_at = now() + interval '5 minutes'")
  })

  it('preserves the durable prospecting session while adding atomic browser ownership', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v5')
    expect(migration).toContain('result := public.start_prospecting_dialer_session_v4(')
    expect(migration).toContain('control_result := public.claim_dialer_session_control_v1(')
    expect(migration).toContain("'control', control_result -> 'control'")
  })

  it('places controller assertion in every server-side state mutation wrapper', () => {
    for (const signature of [
      'transition_dialer_session_v2',
      'request_pause_dialer_session_v2',
      'authorize_dialer_attempt_v4',
      'transition_dialer_attempt_v2',
      'advance_dialer_session_v2',
    ]) {
      const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${signature}`)
      expect(start).toBeGreaterThan(-1)
      const body = migration.slice(start, migration.indexOf('$$;', start) + 3)
      expect(body).toContain('public.assert_dialer_session_control_v1')
    }
  })

  it('fails closed for legacy unclaimed sessions until the operator explicitly claims them', () => {
    const assertionStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.assert_dialer_session_control_v1')
    const assertion = migration.slice(assertionStart, migration.indexOf('$$;', assertionStart) + 3)
    expect(assertion).toMatch(/controller_token_hash IS NULL[\s\S]*RAISE EXCEPTION 'session_control_conflict'/)

    const heartbeatStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.heartbeat_dialer_session_control_v1')
    const heartbeat = migration.slice(heartbeatStart, migration.indexOf('$$;', heartbeatStart) + 3)
    expect(heartbeat).toContain('public.assert_dialer_session_control_v1(')
    expect(heartbeat).not.toContain('public.claim_dialer_session_control_v1(')

    const genericStart = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.start_dialer_session_v3'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v5'),
    )
    expect(genericStart).toMatch(/controller_token_hash IS NULL[\s\S]*RAISE EXCEPTION 'session_control_conflict'/)

    const prospectingStart = migration.slice(
      migration.indexOf('CREATE OR REPLACE FUNCTION public.start_prospecting_dialer_session_v5'),
      migration.indexOf('CREATE OR REPLACE FUNCTION public.transition_dialer_session_v2'),
    )
    expect(prospectingStart).toMatch(/controller_token_hash IS NULL AND NOT p_takeover[\s\S]*RAISE EXCEPTION 'session_control_conflict'/)
  })

  it('keeps all lease and controlled mutation functions service-role only', () => {
    for (const signature of [
      'claim_dialer_session_control_v1',
      'heartbeat_dialer_session_control_v1',
      'start_prospecting_dialer_session_v5',
      'transition_dialer_session_v2',
      'request_pause_dialer_session_v2',
      'authorize_dialer_attempt_v4',
      'transition_dialer_attempt_v2',
      'advance_dialer_session_v2',
    ]) {
      expect(migration).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}\\([\\s\\S]*?FROM PUBLIC, anon, authenticated`))
      expect(migration).toMatch(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}\\([\\s\\S]*?TO service_role`))
    }
  })

  it('retains legacy grants in additive migrations and requires enforcement in a separate post-deploy migration', () => {
    for (const signature of [
      'start_dialer_session_v1',
      'start_dialer_session_v2',
      'start_prospecting_dialer_session_v1',
      'start_prospecting_dialer_session_v2',
      'start_prospecting_dialer_session_v3',
      'start_prospecting_dialer_session_v4',
      'transition_dialer_session_v1',
      'request_pause_dialer_session_v1',
      'authorize_dialer_attempt_v1',
      'authorize_dialer_attempt_v2',
      'authorize_dialer_attempt_v3',
      'transition_dialer_attempt_v1',
      'advance_dialer_session_v1',
    ]) {
      expect(migration).not.toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${signature}\\([\\s\\S]*?FROM service_role`))
    }
    expect(controllerMigration).toContain('Legacy RPC enforcement must ship as a separate post-deploy migration/PR only')
    expect(controllerMigration).toContain('the new exact application SHA has been')
    expect(controllerMigration).toContain('Apply those revocations before')
    expect(controllerMigration).toContain('removing maintenance')
  })

  it('uses the canonical advisory-before-row lock order for AI proposal decisions', () => {
    const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.decide_dialer_ai_change_proposal_v2')
    expect(start).toBeGreaterThan(-1)
    const body = migration.slice(start, migration.indexOf('$$;', start) + 3)
    const advisoryLock = body.indexOf("pg_catalog.hashtextextended('ai-change-proposal:' || proposal_id::text, 0)")
    const proposalRowLock = body.indexOf('WHERE id = proposal_id\n    AND dialer_session_attempt_id = attempt_id\n  FOR UPDATE')
    expect(advisoryLock).toBeGreaterThan(-1)
    expect(proposalRowLock).toBeGreaterThan(advisoryLock)
  })
})
