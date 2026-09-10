import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261102120000_assistant_subject_privacy.sql'),
  'utf8',
)

describe('assistant immutable-subject privacy migration', () => {
  it('backfills immutable subjects from authenticated users', () => {
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS actor_subject text')
    expect(migration).toContain('FROM auth.users AS auth_user')
    expect(migration).toContain('actor_subject = auth_user.id::text')
    expect(migration).toContain('idx_assistant_threads_one_active_per_subject')
    expect(migration).toContain('idx_assistant_generations_subject_request')
  })

  it('authorizes every interactive lifecycle operation by subject instead of email', () => {
    for (const fn of [
      'start_assistant_generation_v2',
      'complete_assistant_generation_v2',
      'fail_assistant_generation_v2',
      'archive_assistant_thread_v2',
    ]) {
      expect(migration).toContain(`CREATE OR REPLACE FUNCTION public.${fn}`)
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${fn}`)
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`)
    }
    expect(migration).toContain('WHERE id = p_thread_id AND actor_subject = clean_subject')
    expect(migration).toContain('WHERE id = p_generation_id AND actor_subject = clean_subject')
    expect(migration).not.toContain('WHERE id = p_thread_id AND lower(actor_email) = clean_actor')
  })

  it('keeps all subject-scoped functions service-role only', () => {
    expect(migration.match(/FROM PUBLIC, anon, authenticated;/g)).toHaveLength(4)
    expect(migration.match(/TO service_role;/g)).toHaveLength(4)
  })
})
