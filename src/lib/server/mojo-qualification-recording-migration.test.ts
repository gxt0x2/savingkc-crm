import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20261030120000_mojo_qualification_recording_evidence.sql',
  'utf8',
)

describe('Mojo qualification and recording evidence migration', () => {
  it('separates provider outcome evidence from CRM promotion authority', () => {
    expect(migration).toContain('promotion_eligible boolean NOT NULL DEFAULT false')
    expect(migration).toContain('duration_value >= 120')
    expect(migration).toContain('recording_value IS NOT NULL')
    expect(migration).toContain('(qualified_by_agent OR seller_intent)')
    expect(migration).toContain("provider_outcome <> 'callback_scheduled' OR p_follow_up_at IS NOT NULL")
    expect(migration).toContain("CASE WHEN promotion_value THEN provider_outcome ELSE 'other' END")
    expect(migration).toContain("'outcome', provider_outcome")
    expect(migration).toContain("qualification_status IN ('eligible', 'ineligible', 'evidence_pending', 'not_applicable')")
  })

  it('creates private durable recording storage and processing state', () => {
    expect(migration).toContain("'mojo-call-recordings'")
    expect(migration).toContain('public = false')
    expect(migration).toContain('recording_storage_path text')
    expect(migration).toContain("recording_processing_status IN ('pending', 'processing', 'copied', 'analyzed', 'failed')")
    expect(migration).toContain("'pending', 'waiting_evidence', 'processing', 'completed', 'failed', 'dead_letter'")
  })

  it('backfills late recording evidence on an exact replay and preserves call time', () => {
    expect(migration).toContain('duration_seconds = greatest(event.duration_seconds, duration_value)')
    expect(migration).toContain('recording_url = coalesce(recording_value, event.recording_url)')
    expect(migration).toContain('event.provider_recording_id = provider_recording_value')
    expect(migration).toContain("p_call := jsonb_set(p_call, '{record_id}', to_jsonb(existing_record_value), true)")
    expect(migration).toContain('created_at = p_call_at')
  })
})
