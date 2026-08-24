import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const runtimeFiles = [
  'src/app/api/ivr/after-record/route.ts',
  'src/app/api/ivr/voicemail-recording/route.ts',
  'src/app/api/ivr/handle-input/route.ts',
  'src/app/api/ivr/no-input/route.ts',
  'src/app/api/ivr/cold-no-input/route.ts',
] as const

const sources = runtimeFiles.map((file) => ({
  file,
  source: readFileSync(join(root, file), 'utf8'),
}))

describe('canonical IVR evidence writers', () => {
  it('keeps every IVR intake and recording path off Manifest compatibility state', () => {
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/manifest-sync|ManifestV2|ensureManifestExists|updateManifest/i)
      expect(source, file).not.toMatch(/from\(['"]manifests['"]\)/)
    }
  })

  it('authenticates every provider callback before doing work', () => {
    for (const { file, source } of sources) {
      expect(source, file).toContain('validateTwilioWebhook')
    }
  })

  it('stores factual recording evidence and stages model-derived changes for approval', () => {
    const recordingSources = sources.filter(({ file }) =>
      file.includes('after-record') || file.includes('voicemail-recording'),
    )

    for (const { file, source } of recordingSources) {
      expect(source, file).toContain('createCallAnalysisLeadProposal')
      expect(source, file).toContain('call_duration_seconds: duration')
      expect(source, file).toContain("source: 'whisper_transcription'")
      expect(source, file).toContain("source: 'call_analysis'")
      expect(source, file).not.toMatch(/leadUpdates\.(?:motivation_score|urgency|property_condition|asking_price)/)
    }
  })

  it('persists explicit caller intent through typed priority fields and checks failures', () => {
    const handleInput = sources.find(({ file }) => file.includes('handle-input'))?.source || ''
    const coldNoInput = sources.find(({ file }) => file.includes('cold-no-input'))?.source || ''

    expect(handleInput).toContain(".update({ priority: 'hot' })")
    expect(handleInput).toContain('if (priorityError) throw priorityError')
    expect(coldNoInput).toContain(".update({ priority: 'warm' })")
    expect(coldNoInput).toContain('if (priorityError) throw priorityError')
  })
})
