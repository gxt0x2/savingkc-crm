/** @vitest-environment jsdom */

import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExcessProceedsDealPanel } from './excess-proceeds-deal-panel'
import type { ExcessProceedsFile } from '@/types/excess-proceeds'

const file: ExcessProceedsFile = {
  id: 'file-1',
  lead_id: 'lead-1',
  track: 'excess_proceeds',
  county_source: 'jackson_dlt',
  suit_no: '24CV-1',
  parcel_no: '99',
  owner_name: 'Ada Owner',
  property_address: '10 Main St',
  city: null,
  state: 'MO',
  zip: null,
  phone: null,
  station: 'new',
  sale_date: '2024-01-15',
  purchase_price: 40000,
  judgment_amount: 30000,
  excess_amount: 2500,
  claim_deadline: '2026-01-15',
  claim_period_elapsed: false,
  days_to_claim_deadline: 20,
  confirmed_date: null,
  deed_date: null,
  set_aside_date: null,
  refund_date: null,
  excess_application_filed_date: null,
  excess_denied_date: null,
  excess_paid_date: null,
  payout_ready: false,
  zestimate: null,
  zestimate_as_of: null,
  score: null,
  owner_is_entity: false,
  counsel_status: 'pending',
  form_pack_status: 'none',
  form_pack_url: null,
  surplus_fee_pct: 10,
  handoff_ready: false,
}

describe('Excess Proceeds field group', () => {
  it('shows Chapter 141 fields and a Drive placeholder', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ file }) })))
    render(<ExcessProceedsDealPanel leadId="lead-1" />)
    expect(await screen.findByRole('region', { name: 'Excess Proceeds (Ch 141)' })).toBeInTheDocument()
    expect(screen.getByText('24CV-1')).toBeInTheDocument()
    expect(screen.getByText('Drive form pack not linked yet.')).toBeInTheDocument()
    expect(screen.getByLabelText('Zestimate')).toHaveValue(null)
  })

  it('stays off a Deal File that is not on this lane', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: 'missing' }) })))
    const { container } = render(<ExcessProceedsDealPanel leadId="lead-2" />)
    await waitFor(() => expect(fetch).toHaveBeenCalled())
    expect(container).toBeEmptyDOMElement()
  })
})
