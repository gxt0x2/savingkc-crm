// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { EntityIntegrityPanel } from './entity-integrity-panel'

const health = {
  available: true,
  source: 'canonical_projection',
  leads: 20,
  linkedLeads: 19,
  people: 18,
  contactMethods: 25,
  properties: 14,
  opportunities: 19,
  openIdentityConflicts: 1,
  consentEvents: 4,
  projectionCoverage: 0.95,
}

describe('EntityIntegrityPanel', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('shows truthful coverage and a bounded human review queue', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify(health), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        items: [{
          id: 'conflict-1',
          leadId: 'lead-1',
          conflictType: 'phone_email_disagree',
          methodType: 'phone',
          maskedValue: '•••3485',
          status: 'open',
          detectedAt: '2026-08-21T12:00:00.000Z',
          selectedPerson: { id: 'person-1', displayName: 'Seller One' },
          conflictingPerson: { id: 'person-2', displayName: 'Seller Two' },
          lead: { id: 'lead-1', fullName: 'Seller One', propertyAddress: '123 Main', station: 'new', assignedAgent: 'Ernest' },
        }],
        pageInfo: { limit: 20, hasMore: false, nextCursor: null },
      }), { status: 200 }))

    render(<EntityIntegrityPanel />)
    expect(await screen.findByText('95%')).toBeInTheDocument()
    expect(screen.getByText('Phone and email point to different people')).toBeInTheDocument()
    expect(screen.getByText(/•••3485/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /review lead/i })).toHaveAttribute('href', '/leads/lead-1')
    expect(screen.queryByText('+14699213485')).not.toBeInTheDocument()
  })

  it('does not turn unavailable or unauthorized data into a clean zero state', async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    render(<EntityIntegrityPanel />)
    expect(await screen.findByText('Administrator access required')).toBeInTheDocument()

    cleanup()
    vi.mocked(fetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Unavailable' }), { status: 500 }))
    render(<EntityIntegrityPanel />)
    await waitFor(() => expect(screen.getByText('Entity integrity is unavailable')).toBeInTheDocument())
    expect(screen.queryByText('No open conflicts')).not.toBeInTheDocument()
  })
})
