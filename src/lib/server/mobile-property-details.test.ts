import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ admin: vi.fn(), rpc: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { MobilePropertyError, parseMobilePropertyPatch, updateMobilePropertyDetails } from './mobile-property-details'

describe('mobile property detail contract', () => {
  beforeEach(() => vi.clearAllMocks())

  it('normalizes a complete editable property draft', () => {
    expect(parseMobilePropertyPatch({
      bedrooms: 3,
      bathrooms: 1.5,
      sqft: 1320,
      yearBuilt: 1954,
      occupancyStatus: 'owner',
      expectedUpdatedAt: '2026-09-18T18:00:00.000Z',
    })).toEqual({
      bedrooms: 3,
      bathrooms: 1.5,
      sqft: 1320,
      yearBuilt: 1954,
      occupancyStatus: 'owner',
      expectedUpdatedAt: '2026-09-18T18:00:00.000Z',
    })
  })

  it('accepts deliberate unknown values but rejects invalid facts', () => {
    expect(parseMobilePropertyPatch({
      bedrooms: null,
      bathrooms: null,
      sqft: null,
      yearBuilt: null,
      occupancyStatus: 'unknown',
      expectedUpdatedAt: '2026-09-18T18:00:00.000Z',
    }).bedrooms).toBeNull()
    expect(() => parseMobilePropertyPatch({
      bedrooms: -1,
      bathrooms: 2,
      sqft: 1000,
      yearBuilt: 1950,
      occupancyStatus: 'owner',
      expectedUpdatedAt: '2026-09-18T18:00:00.000Z',
    })).toThrow(MobilePropertyError)
  })

  it('allows a missing version only so the canonical projection path can create the first property row', () => {
    expect(parseMobilePropertyPatch({
      bedrooms: 3,
      bathrooms: 1,
      sqft: 1100,
      yearBuilt: 1950,
      occupancyStatus: 'unknown',
      expectedUpdatedAt: null,
    }).expectedUpdatedAt).toBeNull()
    expect(() => parseMobilePropertyPatch({
      bedrooms: 3,
      bathrooms: 1,
      sqft: 1100,
      yearBuilt: 1950,
      occupancyStatus: 'unknown',
      expectedUpdatedAt: 'not-a-date',
    })).toThrow('Refresh the property')
  })

  it('uses the shared canonical projection before the first manual property-fact save', async () => {
    let linkReads = 0
    const propertyRow = {
      id: 'property-1', bedrooms: 3, bathrooms: 1, sqft: 1100, year_built: 1950,
      occupancy_status: 'unknown', updated_at: '2026-09-18T18:01:00.000Z',
    }
    mocks.rpc.mockResolvedValue({ error: null })
    mocks.admin.mockReturnValue({
      rpc: mocks.rpc,
      from: (table: string) => {
        if (table === 'crm_lead_entity_links') {
          const query = {
            select: () => query,
            eq: () => query,
            maybeSingle: async () => ({
              data: { property_id: linkReads++ === 0 ? null : 'property-1' },
              error: null,
            }),
          }
          return query
        }
        if (table === 'crm_properties') {
          let updateCalled = false
          const query = {
            select: () => query,
            update: () => { updateCalled = true; return query },
            eq: () => query,
            maybeSingle: async () => updateCalled
              ? ({ data: propertyRow, error: null })
              : ({ data: { updated_at: '2026-09-18T18:00:00.000Z' }, error: null }),
          }
          return query
        }
        return { insert: async () => ({ error: null }) }
      },
    })

    const result = await updateMobilePropertyDetails({
      leadId: 'lead-1',
      actor: { email: 'ernest@savingkc.com', name: 'Ernest' },
      patch: parseMobilePropertyPatch({
        bedrooms: 3,
        bathrooms: 1,
        sqft: 1100,
        yearBuilt: 1950,
        occupancyStatus: 'unknown',
        expectedUpdatedAt: null,
      }),
    })

    expect(mocks.rpc).toHaveBeenCalledWith('refresh_crm_entity_for_lead', { target_lead_id: 'lead-1' })
    expect(result.property).toMatchObject({ id: 'property-1', bedrooms: 3, updatedAt: '2026-09-18T18:01:00.000Z' })
  })

  it('refuses a versionless overwrite when the canonical property already exists', async () => {
    mocks.admin.mockReturnValue({
      rpc: mocks.rpc,
      from: () => {
        const query = {
          select: () => query,
          eq: () => query,
          maybeSingle: async () => ({ data: { property_id: 'property-1' }, error: null }),
        }
        return query
      },
    })

    await expect(updateMobilePropertyDetails({
      leadId: 'lead-1',
      actor: { email: 'ernest@savingkc.com', name: 'Ernest' },
      patch: parseMobilePropertyPatch({
        bedrooms: 3,
        bathrooms: 1,
        sqft: 1100,
        yearBuilt: 1950,
        occupancyStatus: 'unknown',
        expectedUpdatedAt: null,
      }),
    })).rejects.toThrow('Refresh the property')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
})
