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

  it('does not write unapproved model intelligence into the manifest', () => {
    expect(callback).toContain('extractedData: null')
    expect(callback).not.toContain('manifest.situation.motivation.score = analysis')
    expect(callback).not.toContain('manifest.scoring.classification = analysis')
    expect(callback).not.toContain('reminderAutomationSource:')
  })
})
