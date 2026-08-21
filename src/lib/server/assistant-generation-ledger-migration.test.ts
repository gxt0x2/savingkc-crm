import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260825120000_assistant_generation_ledger.sql'),
  'utf8',
)

describe('assistant generation ledger migration contract', () => {
  it('creates durable threads, messages, generations, and confirmations', () => {
    for (const table of ['assistant_threads', 'assistant_messages', 'assistant_generations', 'assistant_confirmations']) {
      expect(migration).toContain(`CREATE TABLE IF NOT EXISTS public.${table}`)
      expect(migration).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`)
    }
    expect(migration).toContain("status text NOT NULL DEFAULT 'proposed'")
    expect(migration).toContain("CHECK (status IN ('proposed', 'approved', 'rejected', 'expired', 'executed', 'cancelled'))")
  })

  it('keeps data and state transitions server-only', () => {
    expect(migration).toContain('FROM PUBLIC, anon, authenticated;')
    expect(migration).toContain('TO service_role;')
    for (const fn of ['start_assistant_generation_v1', 'complete_assistant_generation_v1', 'fail_assistant_generation_v1', 'archive_assistant_thread_v1']) {
      expect(migration).toContain(`REVOKE ALL ON FUNCTION public.${fn}`)
      expect(migration).toContain(`GRANT EXECUTE ON FUNCTION public.${fn}`)
    }
  })

  it('serializes request idempotency and one running generation per thread', () => {
    expect(migration).toContain("hashtextextended('assistant-request:' || clean_actor || ':' || clean_request, 0)")
    expect(migration).toContain('UNIQUE (actor_email, request_id)')
    expect(migration).toContain('idx_assistant_generations_one_running_per_thread')
    expect(migration).toContain('idx_assistant_threads_one_active_per_actor')
    expect(migration).toContain("WHERE status = 'running'")
    expect(migration).toContain("hashtextextended('assistant-actor:' || clean_actor, 0)")
    expect(migration).toContain('FOR UPDATE;')
  })

  it('persists response provenance, usage, pricing, and cost atomically', () => {
    expect(migration).toContain('source_snapshot jsonb')
    expect(migration).toContain('tool_trace jsonb')
    expect(migration).toContain('pricing_snapshot jsonb')
    expect(migration).toContain('estimated_cost_micros bigint')
    expect(migration).toContain("INSERT INTO public.assistant_messages (\n    thread_id, generation_id, role, content, sources, metadata")
    expect(migration).toContain("status = 'complete'")
  })
})
