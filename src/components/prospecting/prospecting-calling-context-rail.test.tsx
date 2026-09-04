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
    expect(screen.getByRole('region', { name: 'Notes' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Note for Mary Seller' })).toBeVisible()
    expect(screen.getAllByText('Helen Seller').length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText('Daughter handles the estate calls.').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText('Saved by Ernest')).toBeVisible()
    expect(screen.getByText('1 items')).toBeVisible()
    expect(screen.getByRole('complementary', { name: 'Seller workspace' })).toBeVisible()
    expect(screen.getByRole('region', { name: 'Subject property' })).toBeVisible()
    expect(screen.getByLabelText('Owner of record')).toHaveTextContent('Mary Seller')
    expect(screen.getByLabelText('Situs address')).toHaveTextContent('123 Main Street, Kansas City, MO 64108')
    expect(screen.getByLabelText('Mailing address')).toHaveTextContent('Not on file')
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

    expect(screen.getByLabelText('Owner of record')).toHaveTextContent('Betty J Moore')
    expect(screen.getAllByText('303 E Partridge St').length).toBeGreaterThan(0)
    expect(screen.getByLabelText('Situs address')).toHaveTextContent('Unit 38')
    expect(screen.getByLabelText('Mailing address')).toHaveTextContent('Unit B')
    expect(screen.getByLabelText('Situs address')).toHaveTextContent('MO 64133')
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
