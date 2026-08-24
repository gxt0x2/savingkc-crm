import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = process.cwd()
const source = (path: string) => readFileSync(resolve(root, path), 'utf8')

describe('Hot Engine runtime retirement', () => {
  it('removes the scheduled reranker and its trusted bearer bypass', () => {
    const vercel = source('vercel.json')
    const proxy = source('src/proxy.ts')
    const registry = source('src/config/system-registry.json')

    expect(vercel).not.toContain('/api/hot-opportunities/cron')
    expect(proxy).not.toContain("'/api/hot-opportunities/cron'")
    expect(registry).not.toMatch(/briefings[\s\S]*\/api\/hot-opportunities\/cron/)
  })

  it('keeps authenticated retirement tombstones without executing scoring work', () => {
    const cron = source('src/app/api/hot-opportunities/cron/route.ts')
    const admin = source('src/app/api/admin/rerank/route.ts')

    expect(cron).toContain("code: 'HOT_ENGINE_RETIRED'")
    expect(cron).toContain('status: 410')
    expect(cron).toContain("'Cache-Control': 'no-store'")
    expect(admin).toContain('requireAdminOrSecret(req)')
    expect(admin).toContain("code: 'HOT_ENGINE_RETIRED'")
    expect(admin).toContain('status: 410')
    expect(`${cron}\n${admin}`).not.toMatch(/fullRerank|revivePastDueParkedLeads|hot-engine/)
  })

  it('removes the executable engine and Manifest-triggered reranking', () => {
    for (const path of [
      'src/lib/hot-engine/ari-signal.ts',
      'src/lib/hot-engine/cache.ts',
      'src/lib/hot-engine/event-bus.ts',
      'src/lib/hot-engine/index.ts',
      'src/lib/hot-engine/scoring.ts',
      'scripts/check-elizabeth.mjs',
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(false)
    }

    expect(existsSync(resolve(root, 'src/lib/manifest-sync.ts'))).toBe(false)
  })

  it('retains the canonical Contacts score source', () => {
    const readModel = source('src/lib/server/contact-directory-read-model.ts')
    const migration = source(
      'supabase/migrations/20261004120000_contact_workspace_canonical_opportunity_score.sql',
    )

    expect(readModel).toContain("db.rpc('contact_workspace_page_v4'")
    expect(migration).toContain('COALESCE(lead.opportunity_score, 0)::INTEGER AS score')
    expect(migration).not.toContain('hot_opportunities_cache')
  })
})
