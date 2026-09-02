import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync('supabase/migrations/20261022120000_mojo_recording_archive.sql', 'utf8')

describe('Mojo recording archive migration', () => {
  it('creates a private bounded storage bucket', () => {
    expect(migration).toContain("VALUES ('mojo-call-recordings', 'mojo-call-recordings', false, 104857600)")
    expect(migration).toContain('SET public = false')
  })

  it('keeps the provider URL and exposes only an authenticated CRM playback path', () => {
    expect(migration).toContain("'recordingSourceUrl', event_row.recording_url")
    expect(migration).toContain("'/api/recordings/mojo/' || p_event_id::text")
    expect(migration).toContain("'recordingUrl', playback_url")
  })

  it('restricts archive commits to the service role', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.archive_crm_mojo_recording_v1[\s\S]+FROM PUBLIC, anon, authenticated/)
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.archive_crm_mojo_recording_v1[\s\S]+TO service_role/)
  })
})
