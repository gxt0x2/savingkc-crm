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

    expect(await screen.findByText('0/4 human verified')).toBeVisible()
    expect(screen.getByText('1 legacy suggestion need human review.')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Capture' }))
    expect(screen.getByRole('dialog', { name: 'Verify four-pillar qualification' })).toBeVisible()
    expect(screen.getByDisplayValue('Within 30 days')).toBeVisible()
    expect(screen.getByText('Legacy hint')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Verify and save all four' })).toBeDisabled()
  })
})
