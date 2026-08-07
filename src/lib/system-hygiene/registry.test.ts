import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { getRegisteredCrons, systemRegistry } from '@/lib/system-hygiene/registry'

describe('system ownership registry', () => {
  it('assigns one owner and status to every uniquely identified feature', () => {
    const ids = systemRegistry.features.map((feature) => feature.id)
    expect(new Set(ids).size).toBe(ids.length)

    for (const feature of systemRegistry.features) {
      expect(feature.owner.trim()).not.toBe('')
      expect(['active', 'experimental', 'deprecated']).toContain(feature.status)
    }
  })

  it('requires a retirement plan for deprecated systems', () => {
    const deprecated = systemRegistry.features.filter((feature) => feature.status === 'deprecated')
    expect(deprecated.length).toBeGreaterThan(0)

    for (const feature of deprecated) {
      expect(feature.retirement?.reason.trim()).toBeTruthy()
      expect(feature.retirement?.targetDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      expect(feature.crons ?? []).toHaveLength(0)
    }
  })

  it('matches the deployed Vercel cron configuration exactly', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
      crons: Array<{ path: string; schedule: string }>
    }
    const registered = getRegisteredCrons().map(({ path, schedule }) => ({ path, schedule }))

    expect(registered.sort((a, b) => a.path.localeCompare(b.path)))
      .toEqual(vercel.crons.sort((a, b) => a.path.localeCompare(b.path)))
  })

  it('documents every high-frequency scheduled job', () => {
    for (const cron of getRegisteredCrons()) {
      if (/^\*\/(5|10)\b/.test(cron.schedule)) {
        expect(cron.highFrequencyReason?.trim()).toBeTruthy()
      }
    }
  })
})
