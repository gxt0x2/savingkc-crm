// @vitest-environment jsdom

import React from 'react'
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeadOpportunityPanel } from './lead-opportunity-panel'

const qualification = {
  complete: false,
  verifiedCount: 0,
  pillars: [
    { pillar: 'TIMELINE', evidence: 'Seller wants to move before winter after finding a new home.', status: 'needs_review', sourceType: 'imported', verifiedBy: null, verifiedAt: null },
    { pillar: 'CONDITION', evidence: '', status: 'missing', sourceType: null, verifiedBy: null, verifiedAt: null },
    { pillar: 'MOTIVATION', evidence: 'Relocating closer to family.', status: 'needs_review', sourceType: 'imported', verifiedBy: null, verifiedAt: null },
    { pillar: 'PRICE', evidence: '', status: 'missing', sourceType: null, verifiedBy: null, verifiedAt: null },
  ],
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('Opportunity panel', () => {
  it('derives Appointment set from the canonical appointment and keeps Favorite or Fool above qualification', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => qualification }))

    render(
      <LeadOpportunityPanel
        leadId="lead-1"
        nextActionTask={null}
        station="new"
        source="inbound_call"
        notes="Seller called back to confirm."
        sellerSituation="Appointment is scheduled."
        isFavorite={false}
        activities={[{
          activity_type: 'sms_received',
          description: 'Confirmed the appointment',
          metadata: { direction: 'inbound' },
          created_at: '2026-09-15T13:00:00.000Z',
        }]}
        score={null}
        motivationScore={8}
        estimatedValue={null}
        offerAmount={null}
        offerMethod={null}
        phoneAvailable
        propertyAddress="123 Main St"
        appointment={{ scheduledAt: '2026-09-18T15:00:00.000Z' }}
        appointmentIsPast={false}
        onCall={() => undefined}
        onAppointment={() => undefined}
        onAppointmentOutcome={() => undefined}
        onOffer={() => undefined}
        onContract={() => undefined}
        onTask={() => undefined}
        onEdit={() => undefined}
      />,
    )

    expect(screen.getByText('Current: Appointment set')).toBeVisible()
    expect(screen.getByText('Synced from the scheduled appointment')).toBeVisible()
    expect(screen.getByText('We are the favorite')).toBeVisible()
    const favorite = screen.getByText('Favorite or Fool')
    const qualificationHeading = await screen.findByText('Four-pillar qualification')
    expect(favorite.compareDocumentPosition(qualificationHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
