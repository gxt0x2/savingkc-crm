import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261002120000_ai_change_proposal_manifest_retirement.sql'),
  'utf8',
)

describe('AI change proposal Manifest retirement migration', () => {
  it('keeps the reviewed decision idempotent, conflict-safe, and service-only', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.decide_ai_change_proposal_v1')
    expect(migration).toContain('pg_advisory_xact_lock')
    expect(migration).toContain('lead_changed_since_proposal')
    expect(migration).toContain('REVOKE ALL ON FUNCTION public.decide_ai_change_proposal_v1')
    expect(migration).toContain('TO service_role')
  })

  it('applies only the five governed canonical lead fields', () => {
    for (const field of ['motivation_score', 'property_condition', 'asking_price', 'opportunity_score', 'classification']) {
      expect(migration).toContain(`'${field}'`)
    }
    expect(migration).toContain('UPDATE public.leads SET')
    expect(migration).toContain('AI-proposed CRM changes reviewed and applied')
  })

  it('never reads or writes Manifest compatibility state', () => {
    expect(migration).not.toMatch(/public\.manifests|FROM\s+public\.manifests|UPDATE\s+public\.manifests/i)
    expect(migration).not.toContain('update_manifest_and_cascade')
  })
})
