// @vitest-environment jsdom

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { EntityIdentityStatus } from './entity-identity-status'
import type { CrmEntityContext } from '@/lib/server/crm-entity-foundation'

function context(overrides: Partial<CrmEntityContext> = {}): CrmEntityContext {
  return {
    available: true,
    linked: true,
    degraded: false,
    projectedAt: '2026-08-21T00:00:00.000Z',
    person: { id: 'person-1', displayName: 'Seller', recordStatus: 'active' },
    contactMethods: [],
    property: null,
    opportunity: { id: 'opp-1', stage: 'new', classification: 'lead', priority: 'warm', ownerName: null, lifecycleStatus: 'open' },
    openIdentityConflicts: 0,
    ...overrides,
  }
}

describe('EntityIdentityStatus', () => {
  it('stays hidden before the additive migration is available', () => {
    const { container } = render(<EntityIdentityStatus context={context({ available: false })} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows linked identity and canonical SMS suppression', () => {
    render(<EntityIdentityStatus context={context({
      contactMethods: [{
        id: 'phone-1', type: 'phone', value: '(913) 555-0100', normalizedValue: '+19135550100',
        isPrimary: true, deliverabilityStatus: 'unknown', smsConsentStatus: 'opted_out',
      }],
    })} />)
    expect(screen.getByText('Canonical record')).toBeInTheDocument()
    expect(screen.getByText('SMS opted out')).toBeInTheDocument()
  })

  it('surfaces ambiguous identity instead of silently claiming success', () => {
    render(<EntityIdentityStatus context={context({ openIdentityConflicts: 2 })} />)
    expect(screen.getByText('Identity review')).toBeInTheDocument()
  })
})
