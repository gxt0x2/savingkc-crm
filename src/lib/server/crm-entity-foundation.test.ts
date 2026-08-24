import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ maybeSingle: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
    }),
  }),
}))

import {
  applyCrmEntityAuthority,
  isEntityFoundationUnavailable,
  readLeadEntityContext,
  safeReadLeadEntityContext,
  type CrmEntityContext,
} from './crm-entity-foundation'

const canonicalContext: CrmEntityContext = {
  available: true,
  linked: true,
  degraded: false,
  projectedAt: '2026-08-24T02:30:00.000Z',
  person: { id: 'person-1', displayName: 'Canonical Seller', recordStatus: 'active' },
  contactMethods: [
    { id: 'email-1', type: 'email', value: 'seller@example.com', normalizedValue: 'seller@example.com', isPrimary: true, deliverabilityStatus: 'unknown', smsConsentStatus: 'not_applicable' },
    { id: 'phone-1', type: 'phone', value: '+18165550123', normalizedValue: '+18165550123', isPrimary: true, deliverabilityStatus: 'unknown', smsConsentStatus: 'unknown' },
  ],
  property: { id: 'property-1', address: '123 Main St', city: 'Kansas City', state: 'MO', zip: '64111', parcelId: null },
  opportunity: { id: 'opportunity-1', stage: 'qualified', classification: 'opportunity', priority: 'hot', ownerName: null, lifecycleStatus: 'open' },
  openIdentityConflicts: 0,
}

describe('CRM entity foundation server reads', () => {
  beforeEach(() => mocks.maybeSingle.mockReset())

  it('recognizes missing-table and stale-schema-cache errors', () => {
    expect(isEntityFoundationUnavailable({ code: '42P01' })).toBe(true)
    expect(isEntityFoundationUnavailable({ code: 'PGRST205' })).toBe(true)
    expect(isEntityFoundationUnavailable({ message: "Could not find crm_lead_entity_links in the schema cache" })).toBe(true)
    expect(isEntityFoundationUnavailable({ code: '42501', message: 'permission denied' })).toBe(false)
  })

  it('returns an explicit migration-pending context when the projection table is absent', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: '42P01', message: 'missing relation' } })
    await expect(readLeadEntityContext('lead-1')).resolves.toMatchObject({
      available: false,
      linked: false,
      degraded: true,
    })
  })

  it('contains unexpected dual-read failures instead of breaking the compatibility lead view', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { code: '500', message: 'temporary database outage' } })
    await expect(safeReadLeadEntityContext('lead-1')).resolves.toMatchObject({
      available: false,
      degraded: true,
    })
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('makes linked canonical identity, property, and opportunity values authoritative', () => {
    expect(applyCrmEntityAuthority({
      id: 'lead-1',
      full_name: 'Stale name',
      phone: '+18160000000',
      email: 'stale@example.com',
      property_address: 'Old address',
      city: 'Old city',
      state: 'KS',
      zip: '66000',
      station: 'new',
      classification: 'lead',
      priority: 'warm',
      assigned_agent: 'Casey',
    }, canonicalContext)).toMatchObject({
      id: 'lead-1',
      full_name: 'Canonical Seller',
      phone: '+18165550123',
      email: 'seller@example.com',
      property_address: '123 Main St',
      city: 'Kansas City',
      state: 'MO',
      zip: '64111',
      station: 'qualified',
      classification: 'opportunity',
      priority: 'hot',
      assigned_agent: null,
      entityAuthority: 'canonical_entities',
    })
  })

  it('falls back explicitly when canonical entities are unavailable', () => {
    const lead = { id: 'lead-1', full_name: 'Compatibility Seller', station: 'lead' }
    expect(applyCrmEntityAuthority(lead, {
      ...canonicalContext,
      available: false,
      linked: false,
      degraded: true,
      person: null,
      opportunity: null,
    })).toEqual({ ...lead, entityAuthority: 'lead_compatibility' })
  })
})
