import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { servicePlace } from '@/lib/market-check/service-place'
import { serviceAreaPlace } from '@/lib/prospecting/foreclosure-service-area'

describe('service places are county and state', () => {
  it('accepts Johnson Kansas and rejects unqualified Johnson and Johnson Missouri', () => {
    expect(servicePlace('johnson', 'KS')).toEqual({ county: 'johnson', state: 'KS' })
    expect(servicePlace('johnson', 'MO')).toBeNull()
    expect(servicePlace('johnson', null)).toBeNull()
    expect(servicePlace('jackson', 'MO')).toEqual({ county: 'jackson', state: 'MO' })
    expect(servicePlace('jackson', 'KS')).toBeNull()
    expect(serviceAreaPlace('Johnson', 'KS')).toEqual({ county: 'johnson', state: 'KS' })
    expect(serviceAreaPlace('Johnson', 'MO')).toBeNull()
    expect(serviceAreaPlace('Johnson', '')).toBeNull()
    expect(serviceAreaPlace('Johnson County, KS')).toEqual({ county: 'johnson', state: 'KS' })
    expect(serviceAreaPlace('Wyandotte')).toEqual({ county: 'wyandotte', state: 'KS' })
  })

  it('removes the Kansas license gate from the new migration', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase/migrations/20261222140001_remove_kansas_outreach_gates.sql'),
      'utf8',
    )
    expect(migration).toContain("RETURN 'ks_license_unconfirmed'")
    expect(migration).toContain('requires_licensee_disclosure IS TRUE')
    expect(migration).toContain("WHEN false THEN NULL")
    expect(migration).toContain("v_county IN ('jackson', 'clay', 'johnson') AND v_state IS NULL")
    expect(migration).not.toMatch(/\bmojo_call_queue\b/i)
  })
})
