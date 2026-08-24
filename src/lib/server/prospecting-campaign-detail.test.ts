import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const source = readFileSync(join(process.cwd(), 'src/lib/server/prospecting-campaigns.ts'), 'utf8')

describe('prospecting campaign operations detail', () => {
  it('reads queue and in-flight counts from server-owned actions', () => {
    expect(source).toContain(".eq('status', 'queued')")
    expect(source).toContain(".eq('status', 'processing')")
    expect(source).toContain("select('id', { count: 'exact', head: true })")
    expect(source).toContain(".eq('status', 'delivered')")
    expect(source).toContain('delivered: countResults[7].count || 0')
  })

  it('bounds the next and latest action lookups to one row', () => {
    expect(source).toContain("select('scheduled_at')")
    expect(source).toContain(".order('scheduled_at', { ascending: true }).limit(1).maybeSingle()")
    expect(source).toContain("select('sent_at')")
    expect(source).toContain(".order('sent_at', { ascending: false }).limit(1).maybeSingle()")
  })
})
