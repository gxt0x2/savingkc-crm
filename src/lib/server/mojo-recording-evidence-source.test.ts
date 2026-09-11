import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const evidence = readFileSync('src/lib/server/mojo-recording-evidence.ts', 'utf8')
const playback = readFileSync('src/app/api/recordings/mojo/[eventId]/route.ts', 'utf8')

describe('Mojo recording evidence source contract', () => {
  it('copies recordings before transcription and stores the AI summary separately', () => {
    expect(evidence).toContain("MOJO_RECORDING_BUCKET = 'mojo-call-recordings'")
    expect(evidence).toContain("recording_processing_status: 'copied'")
    expect(evidence).toContain('transcribeAudio(filePath)')
    expect(evidence).toContain('AI Call Summary:')
    expect(evidence).toContain("source: 'call_analysis'")
    expect(evidence).toContain('createCallAnalysisLeadProposal')
    expect(evidence).not.toMatch(/from\('leads'\)\.update/)
  })

  it('serves only authenticated, allowlisted provider or private stored audio', () => {
    expect(playback).toContain('requireAuthenticatedUser()')
    expect(playback).toContain("createSignedUrl(event.recording_storage_path, 60)")
    expect(playback).toContain("parsed.hostname.endsWith('.mojosells.com')")
    expect(playback).toContain("const range = request.headers.get('range')")
  })
})
