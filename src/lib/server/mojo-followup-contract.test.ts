import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const liveSync = readFileSync('scripts/mojo-sync.mjs', 'utf8')
const eodSync = readFileSync('scripts/mojo-eod-sweep.mjs', 'utf8')
const searchRoute = readFileSync('src/app/api/leads/search/route.ts', 'utf8')

describe('Mojo scheduled follow-up contract', () => {
  it.each([liveSync, eodSync])('ingests provider follow-up activities even without seller-intent notes', (source) => {
    expect(source).toContain('const hasScheduledFollowUp = Boolean(entry.followUpDate)')
    expect(source).toMatch(/const isMeaningful = .*hasScheduledFollowUp/)
    expect(source).toContain("hasScheduledFollowUp || groupLower.includes('follow up')")
  })

  it('keeps the global search inclusive of prospect and terminal contact shells', () => {
    expect(searchRoute).toContain(".from('leads')")
    expect(searchRoute).not.toMatch(/\.eq\(['"](?:station|classification)['"]/)
    expect(searchRoute).not.toMatch(/\.in\(['"](?:station|classification)['"]/)
  })
})
