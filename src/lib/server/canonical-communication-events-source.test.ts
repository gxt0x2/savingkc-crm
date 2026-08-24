import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const runtimeFiles = [
  'src/app/api/call-log/route.ts',
  'src/app/api/conversations/send/route.ts',
  'src/app/api/ivr/dial-result/route.ts',
  'src/app/api/mobile/v1/messages/route.ts',
  'src/app/api/twilio-missed-call/route.ts',
  'src/app/api/twilio-sms-webhook/route.ts',
  'src/app/api/twilio/fallback/sms/route.ts',
  'src/lib/send-lead-sms.ts',
] as const

const sources = runtimeFiles.map((file) => ({
  file,
  source: readFileSync(join(root, file), 'utf8'),
}))

describe('canonical communication event writers', () => {
  it('keeps every primary call, text, and email path off Manifest compatibility state', () => {
    for (const { file, source } of sources) {
      expect(source, file).not.toMatch(/manifest-sync|onCommunicationEvent|ensureManifestExists|updateManifestAndCascade/i)
      expect(source, file).not.toMatch(/from\(['"]manifests['"]\)/)
    }
  })

  it('retains durable canonical communication evidence on every path', () => {
    expect(sources.find(({ file }) => file.includes('call-log/'))?.source).toContain('insertCallLogEvidenceOnce')
    for (const { file, source } of sources.filter(({ file }) => !file.includes('call-log/'))) {
      expect(source, file).toContain('lead_activities')
    }
  })

  it('promotes an explicit YES reply through the typed lead priority and fails closed on persistence', () => {
    const webhook = sources.find(({ file }) => file.includes('twilio-sms-webhook'))?.source || ''
    expect(webhook).toContain(".update({ priority: 'hot' })")
    expect(webhook).toContain('if (priorityError) throw priorityError')
    expect(webhook).toContain("regenerateBriefing(yesLeadId, 'yes_reply')")
  })

  it('uses the canonical activity trigger to queue cited briefings', () => {
    const migration = readFileSync(
      join(root, 'supabase/migrations/20260929120000_canonical_ai_briefings.sql'),
      'utf8',
    )
    expect(migration).toContain('trigger_queue_briefing_from_activity')
    for (const type of ['call', 'sms', 'email', 'missed_call', 'note']) {
      expect(migration).toContain(`'${type}'`)
    }
  })
})
