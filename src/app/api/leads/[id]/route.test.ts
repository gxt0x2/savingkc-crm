import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
  entityContext: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/api/require-authenticated-user', () => ({ requireAuthenticatedUser: vi.fn() }))
vi.mock('@/lib/server/crm-entity-foundation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/crm-entity-foundation')>()
  return { ...actual, safeReadLeadEntityContext: mocks.entityContext }
})
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => ({ update: mocks.update }),
  }),
}))

import { PATCH } from './route'

const params = { params: Promise.resolve({ id: 'lead-1' }) }

function request(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/leads/lead-1', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('typed lead profile updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest Dodson' })
    mocks.entityContext.mockResolvedValue({
      available: false,
      linked: false,
      degraded: true,
      projectedAt: null,
      person: null,
      contactMethods: [],
      property: null,
      opportunity: null,
      openIdentityConflicts: 0,
    })
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'lead-1', full_name: 'Seller Name' }, error: null })
    mocks.select.mockReturnValue({ maybeSingle: mocks.maybeSingle })
    mocks.eq.mockReturnValue({ select: mocks.select })
    mocks.update.mockReturnValue({ eq: mocks.eq })
  })

  it('rejects anonymous updates before parsing or touching the database', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request({ kind: 'profile', profile: { full_name: 'Seller' } })
    const parse = vi.spyOn(req, 'json')

    const response = await PATCH(req, params)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('updates only allowlisted profile fields and drops client lifecycle fields', async () => {
    const response = await PATCH(request({
      kind: 'profile',
      profile: { full_name: ' Seller Name ', station: 'closed_won', is_admin: true },
      actor: 'Spoofed Agent',
    }), params)

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ full_name: 'Seller Name' }))
    const patch = mocks.update.mock.calls[0][0]
    expect(patch).not.toHaveProperty('station')
    expect(patch).not.toHaveProperty('is_admin')
    expect(patch).not.toHaveProperty('actor')
  })

  it('rejects unsupported update commands before writing', async () => {
    const response = await PATCH(request({ kind: 'lifecycle', station: 'closed_won' }), params)
    expect(response.status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('returns canonical entity values after the compatibility write-through refreshes', async () => {
    mocks.entityContext.mockResolvedValue({
      available: true,
      linked: true,
      degraded: false,
      projectedAt: '2026-08-24T02:30:00.000Z',
      person: { id: 'person-1', displayName: 'Canonical Seller', recordStatus: 'active' },
      contactMethods: [
        { id: 'phone-1', type: 'phone', value: '+18165550123', normalizedValue: '+18165550123', isPrimary: true, deliverabilityStatus: 'unknown', smsConsentStatus: 'unknown' },
      ],
      property: { id: 'property-1', address: '123 Main St', city: 'Kansas City', state: 'MO', zip: '64111', parcelId: null },
      opportunity: { id: 'opportunity-1', stage: 'lead', classification: 'opportunity', priority: 'hot', ownerName: 'Ernest', lifecycleStatus: 'open' },
      openIdentityConflicts: 0,
    })

    const response = await PATCH(request({ kind: 'profile', profile: { full_name: 'Canonical Seller' } }), params)
    const body = await response.json()

    expect(body.lead).toMatchObject({
      full_name: 'Canonical Seller',
      phone: '+18165550123',
      property_address: '123 Main St',
      station: 'lead',
      assigned_agent: 'Ernest',
      entityAuthority: 'canonical_entities',
    })
  })
})
