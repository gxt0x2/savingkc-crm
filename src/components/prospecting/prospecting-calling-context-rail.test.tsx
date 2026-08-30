/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ProspectingCallingContextRail } from './prospecting-calling-context-rail'

describe('ProspectingCallingContextRail', () => {
  it('keeps source-Prospect contact notes visible in seller history', () => {
    render(<ProspectingCallingContextRail
      leadId={null}
      lead={null}
      prospect={{
        id: 'prospect-1',
        owner_1: 'Mary Seller',
        situs_street: '123 Main Street',
        situs_city: 'Kansas City',
        situs_state: 'MO',
        situs_zip: '64108',
        county: 'Jackson',
        is_deceased: true,
        occupancy_status: 'absentee',
        delinquent_years_category: '2-year',
        mailing_street: null,
        mailing_city: null,
        mailing_state: null,
        mailing_zip: null,
        cumulative_due: 6_000,
        zestimate: 198_000,
        total_market_value: 144_000,
        earliest_delinquent_year: 2024,
      }}
      ownerName="Mary Seller"
      situsAddress="123 Main Street Kansas City, MO 64108"
      coOwners={[]}
      occupancy={null}
      delinquentYears="2 yr"
      durableSessionId=""
      activities={[{
        id: 'activity-1',
        activity_type: 'note',
        description: 'Daughter handles the estate calls.',
        agent: 'Ernest',
        metadata: {
          source: 'prospecting_contact_note',
          prospect_id: 'prospect-1',
          contact_name: 'Helen Seller',
        },
        created_at: '2026-08-26T12:00:00.000Z',
      }]}
      activeTab="activity"
      callerId="+18163077835"
      onTabChange={vi.fn()}
      onRefreshActivities={vi.fn()}
    />)

    expect(screen.getByRole('region', { name: 'Contact notes' })).toBeVisible()
    expect(screen.getByText('Helen Seller')).toBeVisible()
    expect(screen.getByText('Daughter handles the estate calls.')).toBeVisible()
    expect(screen.getByText('Saved by Ernest')).toBeVisible()
    expect(screen.getByText('1 items')).toBeVisible()
    expect(screen.getByLabelText('Owner name cells')).toBeVisible()
    expect(screen.getByLabelText('Situs address cells')).toBeVisible()
    expect(screen.getByLabelText('Mailing address cells')).toBeVisible()
  })

  it('shows swallowed MI and unit in their own cells without turning MO into Mo', () => {
    render(<ProspectingCallingContextRail
      leadId={null}
      lead={null}
      prospect={{
        id: 'prospect-lock',
        owner_1: 'MOORE BETTY J',
        owner_1_first: 'BETTY J',
        owner_1_last: 'MOORE',
        situs_street: '303 E PARTRIDGE ST UNIT 38',
        situs_city: 'KANSAS CITY',
        situs_state: 'MO',
        situs_zip: '64133',
        county: 'Jackson',
        is_deceased: true,
        occupancy_status: 'absentee',
        delinquent_years_category: '3yr_plus',
        mailing_street: '303 E PARTRIDGE ST UNIT B',
        mailing_city: 'KANSAS CITY',
        mailing_state: 'MO',
        mailing_zip: '64133',
        cumulative_due: 6_000,
        zestimate: 198_000,
        total_market_value: 144_000,
        earliest_delinquent_year: 2024,
      }}
      ownerName="Betty J Moore"
      situsAddress="303 E Partridge St Unit 38, Kansas City, MO 64133"
      coOwners={[]}
      occupancy={null}
      delinquentYears="3+ yr"
      durableSessionId=""
      activities={[]}
      activeTab="activity"
      callerId="+18163077835"
      onTabChange={vi.fn()}
      onRefreshActivities={vi.fn()}
    />)

    expect(screen.getByText('Betty')).toBeVisible()
    expect(screen.getByText('J')).toBeVisible()
    expect(screen.getByText('Moore')).toBeVisible()
    expect(screen.getByText('303 E Partridge St')).toBeVisible()
    expect(screen.getByText('Unit 38')).toBeVisible()
    expect(screen.getByText('Unit B')).toBeVisible()
    expect(screen.getAllByText((content) => content === 'MO').length).toBeGreaterThan(0)
  })

  it('keeps the Text Hub visible but removes its composer in read-only preview', () => {
    render(<ProspectingCallingContextRail
      leadId="lead-1"
      lead={{
        id: 'lead-1',
        full_name: 'Helen Seller',
        phone: '+18165550123',
        email: null,
        property_address: '123 Main Street',
        city: 'Kansas City',
        state: 'MO',
        zip: '64108',
        county: 'Jackson',
        is_favorite: false,
      }}
      prospect={null}
      ownerName="Helen Seller"
      situsAddress="123 Main Street Kansas City, MO 64108"
      coOwners={[]}
      occupancy={null}
      delinquentYears={null}
      durableSessionId=""
      activities={[]}
      activeTab="texts"
      callerId="+18163077835"
      readOnlyPreview
      onTabChange={vi.fn()}
      onRefreshActivities={vi.fn()}
    />)

    expect(screen.getByText(/Texting is visible for workflow review but disabled/i)).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Type a text...' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send text' })).not.toBeInTheDocument()
  })
})
