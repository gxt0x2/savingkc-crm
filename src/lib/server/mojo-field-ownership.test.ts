import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  MOJO_FIELD_OWNERSHIP,
  MOJO_FIELD_OWNERSHIP_VERSION,
  projectApprovedMojoLeadPatch,
} from './mojo-field-ownership'

const call = {
  record_id: 'mojo-123',
  contact_name: 'Seller Name',
  phone_number: '+18165550123',
  email: 'SELLER@example.com',
  disposition: 'Callback Requested',
  call_duration: 92.8,
}

describe('Mojo field ownership', () => {
  it('updates only the approved identity gaps and operational snapshot', () => {
    expect(projectApprovedMojoLeadPatch(
      { full_name: 'Unknown', phone: '', email: null },
      call,
      { latestForLead: true },
    )).toEqual({
      full_name: 'Seller Name',
      phone: '+18165550123',
      email: 'seller@example.com',
      mojo_record_id: 'mojo-123',
      call_result: 'Callback Requested',
      call_duration_seconds: 92,
    })
  })

  it('never overwrites established CRM identity and ignores older provider events', () => {
    expect(projectApprovedMojoLeadPatch(
      { full_name: 'Canonical Seller', phone: '+19135550123', email: 'crm@example.com' },
      call,
      { latestForLead: true },
    )).toEqual({
      mojo_record_id: 'mojo-123',
      call_result: 'Callback Requested',
      call_duration_seconds: 92,
    })
    expect(projectApprovedMojoLeadPatch({}, call, { latestForLead: false })).toEqual({})
  })

  it('keeps county, tax, deceased, property, and source fields canonical', () => {
    expect(MOJO_FIELD_OWNERSHIP_VERSION).toBe('mojo_field_ownership_v1')
    expect(MOJO_FIELD_OWNERSHIP.canonicalOnly).toEqual(expect.arrayContaining([
      'county',
      'tax_delinquent',
      'tax_delinquent_years',
      'cumulative_due',
      'deceased',
      'property_address',
      'source',
    ]))

    const migration = fs.readFileSync(
      'supabase/migrations/20261011120000_mojo_field_ownership_v1.sql',
      'utf8',
    )
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb")
    const leadUpdate = migration.split('IF is_latest THEN')[1]?.split('END IF;')[0] ?? ''
    for (const field of MOJO_FIELD_OWNERSHIP.canonicalOnly) {
      expect(leadUpdate).not.toMatch(new RegExp(`\\b${field}\\s*=`))
    }
  })
})
