/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { LeadWorkspace, type LeadWorkspaceLead } from '../lead-workspace'

vi.mock('@/components/leads/google-map-panel', () => ({
  StreetViewPanel: ({ address }: { address: string }) => <div data-testid="street-view-panel">Street View for {address}</div>,
}))

const lead: LeadWorkspaceLead = {
  id: 'lead-1',
  full_name: 'Joseph Cross',
  phone: '9135550100',
  email: 'joseph@example.com',
  property_address: '6509 W 74TH ST',
  city: 'Overland Park',
  state: 'KS',
  zip: '66204',
  source: 'google_ads',
  station: 'qualified',
  priority: 'hot',
  assigned_agent: 'Ernest',
  beds: 2,
  baths_full: 1,
  baths_half: 0,
  sqft: 794,
  year_built: 1940,
  motivation_score: 80,
  arv: 270000,
  offer_amount: 180000,
  classification: 'opportunity',
  dead_reason: null,
}

const noop = () => {}

function renderWorkspace(onOpenProperty = vi.fn()) {
  render(
    <LeadWorkspace
      lead={lead}
      activities={[]}
      appointment={null}
      score={80}
      assessedValue={270000}
      onCall={noop}
      onEdit={noop}
      onText={noop}
      onEmail={noop}
      onAppointment={noop}
      onAppointmentOutcome={noop}
      onTask={noop}
      onContract={noop}
      onOpenProperty={onOpenProperty}
      onRefresh={noop}
      onStageChange={noop}
      onLeadStatusChange={noop}
    />,
  )
  return onOpenProperty
}

describe('LeadWorkspace property actions', () => {
  afterEach(() => {
    cleanup()
  })

  it('opens interactive Street View when the property image is clicked', () => {
    const onOpenProperty = renderWorkspace()

    fireEvent.click(screen.getByRole('button', { name: 'Open Street View for 6509 W 74TH ST, Overland Park, KS, 66204' }))

    expect(screen.getByRole('dialog', { name: 'Street View · 6509 W 74TH ST, Overland Park, KS, 66204' })).toBeInTheDocument()
    expect(screen.getByTestId('street-view-panel')).toHaveTextContent('6509 W 74TH ST, Overland Park, KS, 66204')
    expect(onOpenProperty).not.toHaveBeenCalled()
  })

  it('opens county property details from the Property details controls', () => {
    const onOpenProperty = renderWorkspace()
    const detailControls = screen.getAllByRole('button', { name: 'Open property details and county records' })

    expect(detailControls).toHaveLength(2)
    fireEvent.click(detailControls[0])

    expect(onOpenProperty).toHaveBeenCalledOnce()
    expect(screen.queryByRole('dialog', { name: /Street View/ })).not.toBeInTheDocument()
  })

  it('closes Street View with Escape', () => {
    renderWorkspace()
    fireEvent.click(screen.getByRole('button', { name: 'Open Street View for 6509 W 74TH ST, Overland Park, KS, 66204' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog', { name: /Street View/ })).not.toBeInTheDocument()
  })
})
