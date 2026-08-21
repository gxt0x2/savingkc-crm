import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/lib/server/prospecting-campaign-activity.ts'), 'utf8')

describe('prospecting campaign activity data plane', () => {
  it('checks campaign ownership before reading protected history', () => {
    expect(source.indexOf(".eq('owner_email', actor.email.toLowerCase())")).toBeGreaterThan(-1)
    expect(source.indexOf(".eq('owner_email', actor.email.toLowerCase())")).toBeLessThan(source.indexOf(".from('prospecting_campaign_events')"))
  })

  it('uses indexed keyset ordering and caps every hydration set', () => {
    expect(source).toContain(".order('created_at', { ascending: false })")
    expect(source).toContain(".order('id', { ascending: false })")
    expect(source).toContain('.limit(limit + 1)')
    expect(source).toContain("created_at.lt.${cursor.createdAt}")
    expect(source.match(/\.limit\(50\)/g)).toHaveLength(2)
  })
})
