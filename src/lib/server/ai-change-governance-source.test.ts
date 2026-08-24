import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const callback = readFileSync(
  join(process.cwd(), 'src/app/api/twilio-recording-callback/route.ts'),
  'utf8',
)

describe('recording callback AI governance boundary', () => {
  it('stages model-derived lead fields and automatically stores only factual call evidence', () => {
    expect(callback).toContain('createCallAnalysisLeadProposal')
    expect(callback).toContain("transcript,\n      call_duration_seconds: duration")
    expect(callback).not.toMatch(/leadUpdates\.motivation_score/)
    expect(callback).not.toMatch(/leadUpdates\.classification/)
    expect(callback).not.toContain('upsertAppointmentFromCall')
    expect(callback).not.toContain('syncCoOwners')
  })

  it('stores recording evidence canonically and never writes Manifest compatibility state', () => {
    expect(callback).toContain("source: 'whisper_transcription'")
    expect(callback).toContain("source: 'call_analysis'")
    expect(callback).toContain('recordingUrl: `${recordingUrl}.mp3`')
    expect(callback).toContain('transcript_evidence_write_failed')
    expect(callback).toContain('call_analysis_evidence_write_failed')
    expect(callback).not.toMatch(/manifest-sync|MutableManifest|updateManifestAndCascade|briefingStale/i)
  })
})
