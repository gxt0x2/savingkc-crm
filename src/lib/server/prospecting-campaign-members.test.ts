import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/lib/server/prospecting-campaign-members.ts'), 'utf8')

describe('prospecting campaign audience data plane', () => {
  it('checks actor ownership before reading member rows', () => {
    expect(source.indexOf(".eq('owner_email', actor.email.toLowerCase())")).toBeLessThan(source.indexOf(".from('prospecting_campaign_members')"))
  })

  it('uses the campaign status index ordering and a capped keyset page', () => {
    expect(source).toContain(".order('enrolled_at', { ascending: false })")
    expect(source).toContain(".order('id', { ascending: false })")
    expect(source).toContain('.limit(limit + 1)')
    expect(source).toContain('enrolled_at.lt.${cursor.enrolledAt}')
  })
})
