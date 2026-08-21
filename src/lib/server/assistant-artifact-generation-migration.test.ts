import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260901120000_assistant_artifact_generation.sql'),
  'utf8',
)

describe('standalone assistant artifact migration', () => {
  it('creates an archived API thread before the model result exists', () => {
    expect(migration).toContain('start_assistant_artifact_generation_v1')
    expect(migration).toContain("clean_title, 'archived', 'api'")
    expect(migration).toContain("status\n  ) VALUES (\n    target_thread.id, request_message.id, clean_actor, clean_request, 'running'")
  })

  it('deduplicates by the canonical actor request key', () => {
    expect(migration).toContain("hashtextextended('assistant-request:' || clean_actor || ':' || clean_request, 0)")
    expect(migration).toContain('WHERE actor_email = clean_actor AND request_id = clean_request')
    expect(migration).toContain("'created', false")
  })

  it('keeps artifact creation service-role-only', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated;')
    expect(migration).toContain('TO service_role;')
    expect(migration).toContain('SECURITY DEFINER')
    expect(migration).toContain('SET search_path = pg_catalog, public')
  })
})
