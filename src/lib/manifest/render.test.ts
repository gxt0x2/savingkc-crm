import { describe, it, expect } from 'vitest'
import { encode } from 'gpt-tokenizer'
import { manifestV2_1Schema, type ManifestV2_1 } from './schema'
import { renderPreCallBriefing } from './render.preCall'

import fullRaw from './__fixtures__/full.json'
import minimalRaw from './__fixtures__/minimal.json'
import pendingRaw from './__fixtures__/pending.json'
import hotRaw from './__fixtures__/hot.json'
import staleRaw from './__fixtures__/stale.json'

// Freeze the clock for every render so snapshots are deterministic.
const NOW = new Date('2026-04-18T12:00:00.000Z')

function parse(raw: unknown): ManifestV2_1 {
  return manifestV2_1Schema.parse(raw)
}

const fixtures = {
  full: parse(fullRaw),
  minimal: parse(minimalRaw),
  pending: parse(pendingRaw),
  hot: parse(hotRaw),
  stale: parse(staleRaw),
}

describe('renderPreCallBriefing — snapshots', () => {
  for (const [name, m] of Object.entries(fixtures)) {
    it(`${name}.json renders deterministic Markdown`, () => {
      const out = renderPreCallBriefing(m, { now: NOW })
      expect(out).toMatchSnapshot()
    })
  }
})

describe('renderPreCallBriefing — invariants', () => {
  it('full fixture renders under 1500 tokens', () => {
    const out = renderPreCallBriefing(fixtures.full, { now: NOW })
    expect(encode(out).length).toBeLessThan(1500)
  })

  it('every fixture renders under 1500 tokens', () => {
    for (const [name, m] of Object.entries(fixtures)) {
      const out = renderPreCallBriefing(m, { now: NOW })
      expect(encode(out).length, `${name} exceeded budget`).toBeLessThan(1500)
    }
  })

  it('rendering is deterministic (same inputs + now → byte-identical output)', () => {
    const a = renderPreCallBriefing(fixtures.full, { now: NOW })
    const b = renderPreCallBriefing(fixtures.full, { now: NOW })
    expect(a).toEqual(b)
  })

  it('output is valid Markdown (no JSON artifacts, no stray braces)', () => {
    const out = renderPreCallBriefing(fixtures.full, { now: NOW })
    // No unbalanced JSON braces or array literals in the body
    expect(out).not.toMatch(/\{\s*"/) // no {"foo":...
    expect(out).not.toMatch(/\[\s*\{/) // no [{...}]
  })
})

describe('renderPreCallBriefing — tri-state field handling', () => {
  it('pending next_action renders the pending phrase, not JSON', () => {
    const out = renderPreCallBriefing(fixtures.pending, { now: NOW })
    expect(out).toContain('_Evaluation in progress._')
    expect(out).not.toContain('"pending"')
  })

  it('minimal fixture omits all optional sections', () => {
    const out = renderPreCallBriefing(fixtures.minimal, { now: NOW })
    // Subtrees that are absent in minimal.json should produce no section
    expect(out).not.toContain('## Open objections')
    expect(out).not.toContain('## Key leverage points')
    expect(out).not.toContain('## Red flags')
    expect(out).not.toContain('## Voice of the seller')
    // Motivation is absent → no "primary driver" line
    expect(out).not.toContain('primary driver')
  })

  it('stale fixture surfaces the staleness warning', () => {
    const out = renderPreCallBriefing(fixtures.stale, { now: NOW })
    expect(out).toContain('Briefing flagged stale')
  })

  it('hot fixture surfaces the eligible verdict', () => {
    const out = renderPreCallBriefing(fixtures.hot, { now: NOW })
    expect(out).toContain('Hot Opportunity verdict: eligible')
  })
})

describe('renderPreCallBriefing — trimming', () => {
  it('applies trim steps when budget is tight', () => {
    // Artificially low budget forces trim cascade.
    const tightBudget = renderPreCallBriefing(fixtures.full, { now: NOW, token_budget: 400 })
    const comfortable = renderPreCallBriefing(fixtures.full, { now: NOW })
    expect(encode(tightBudget).length).toBeLessThanOrEqual(encode(comfortable).length)
    // First 4 sections must survive even under extreme trim
    expect(tightBudget).toContain('# Pre-Call Briefing')
    expect(tightBudget).toContain('## What to do on this call')
    expect(tightBudget).toContain('## Seller snapshot')
    expect(tightBudget).toContain('## Financials at a glance')
  })

  it('never drops the header on any fixture at a very tight budget', () => {
    for (const [, m] of Object.entries(fixtures)) {
      const out = renderPreCallBriefing(m, { now: NOW, token_budget: 200 })
      expect(out).toMatch(/^# Pre-Call Briefing/)
    }
  })
})

describe('renderPreCallBriefing — formatting', () => {
  it('formats money with commas and dollar signs', () => {
    const out = renderPreCallBriefing(fixtures.full, { now: NOW })
    expect(out).toMatch(/\$180,000/)
  })

  it('renders relative dates for same-year timestamps', () => {
    const out = renderPreCallBriefing(fixtures.full, { now: NOW })
    // last_meaningful_contact_at is 2026-04-15T18:30Z, now is 2026-04-18T12:00Z.
    // That's a partial day shy of 3 days, so Math.floor gives 2.
    expect(out).toMatch(/Last meaningful contact: 2 days ago/)
    // next_scheduled_contact_at is Apr 22 (same year) → "Apr 22"
    expect(out).toMatch(/Next scheduled: Apr 22/)
  })
})
