import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261202130000_source_list_dialer_load_proof.sql'),
  'utf8',
)

describe('source list load proof migration', () => {
  it('drops wrong-number and disconnected prospect phones into the suppressed view', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.source_list_phone_block_reason_v1')
    expect(migration).toContain("= 'wrong_number'")
    expect(migration).toContain("THEN 'wrong_number'")
    expect(migration).toContain("THEN 'disconnected'")
    expect(migration).toContain('phone.phone_connected::text')
    expect(migration).toContain('phone.last_disposition')
    expect(migration).toContain("'disconnected', 'bad_number', 'not_in_service'")
    expect(migration).toContain("IN ('false', 'no', 'disconnected', 'bad_number')")
    expect(migration).not.toMatch(/\b(?:DELETE\s+FROM|TRUNCATE|DROP\s+(?:TABLE|SCHEMA))\b/i)
    expect(migration).not.toMatch(/\b(?:insert|update|delete|from|join|into|truncate)\s+(?:public\.)?mojo_call_queue\b/i)
  })

  it('records loaded_at and the export batch that produced the scrub', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.source_list_export_batches')
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.source_list_export_batch_phones')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS loaded_at timestamptz')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS loaded_export_batch_id uuid')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS export_batch_id uuid')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.record_source_list_export_batch_v1')
    expect(migration).toContain('source_list_export_batch_required')
    expect(migration).toContain("WHEN v_status = 'loaded_to_dialer' THEN clock_timestamp()")
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('GRANT SELECT, INSERT ON TABLE public.source_list_export_batches, public.source_list_export_batch_phones')
  })
})
