// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeadQualificationPanel } from './lead-qualification-panel'

const legacyResponse = {
  complete: false,
  verifiedCount: 0,
  pillars: [
    { pillar: 'TIMELINE', evidence: 'Within 30 days', status: 'needs_review', sourceType: 'legacy_manifest', verifiedBy: null, verifiedAt: null },
    { pillar: 'CONDITION', evidence: '', status: 'missing', sourceType: null, verifiedBy: null, verifiedAt: null },
    { pillar: 'MOTIVATION', evidence: '', status: 'missing', sourceType: null, verifiedBy: null, verifiedAt: null },
    { pillar: 'PRICE', evidence: '', status: 'missing', sourceType: null, verifiedBy: null, verifiedAt: null },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('lead qualification panel', () => {
  it('labels legacy evidence for review and never presents it as verified', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => legacyResponse }))

    render(<LeadQualificationPanel leadId="lead-1" />)

    expect(screen.getByRole('region', { name: 'Seller qualification' })).toHaveAttribute('id', 'lead-qualification')
    expect(await screen.findByText('0/4 verified · 1 to confirm · 3 missing')).toBeVisible()
    expect(screen.getByText('Within 30 days')).toBeVisible()
    expect(screen.queryByText('R')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('dialog', { name: 'Verify four-pillar qualification' })).toBeVisible()
    expect(screen.getByDisplayValue('Within 30 days')).toBeVisible()
    expect(screen.getByText('Confirm suggestion')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Verify and save 1' })).toBeEnabled()
  })

  it('saves a single completed pillar and updates the visible evidence', async () => {
    const verifiedTimeline = {
      ...legacyResponse,
      verifiedCount: 1,
      pillars: legacyResponse.pillars.map((row) => row.pillar === 'TIMELINE'
        ? { ...row, status: 'verified', sourceType: 'operator', verifiedBy: 'Casey', verifiedAt: '2026-09-15T12:00:00.000Z' }
        : row),
    }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => legacyResponse })
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedTimeline })
      .mockResolvedValueOnce({ ok: true, json: async () => verifiedTimeline })
    vi.stubGlobal('fetch', fetchMock)

    render(<LeadQualificationPanel leadId="lead-1" />)
    expect(await screen.findByText('Within 30 days')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Review' }))
    fireEvent.click(screen.getByRole('button', { name: 'Verify and save 1' }))

    expect(await screen.findByText('1/4 verified · 3 missing')).toBeVisible()
    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/leads/lead-1/qualification', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ pillars: { TIMELINE: 'Within 30 days' } }),
    }))
  })
})
