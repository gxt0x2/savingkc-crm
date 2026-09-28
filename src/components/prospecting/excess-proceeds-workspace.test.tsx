/** @vitest-environment jsdom */

import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ExcessProceedsWorkspace } from './excess-proceeds-workspace'
import type { ExcessProceedsFile } from '@/types/excess-proceeds'

vi.mock('@/components/conversations/workspace-frame', () => ({
  WorkspaceChrome: ({ commandBar }: { commandBar: ReactNode }) => <div>{commandBar}</div>,
}))

const file: ExcessProceedsFile = {
  id: 'file-1',
  lead_id: 'lead-1',
  track: 'excess_proceeds',
  county_source: 'jackson_dlt',
  suit_no: '24CV-1',
  parcel_no: '99',
  owner_name: 'Ada Owner',
  property_address: '10 Main St',
  city: 'Kansas City',
  state: 'MO',
  zip: '64101',
  phone: '+18165550100',
  station: 'new',
  sale_date: '2024-01-15',
  purchase_price: null,
  judgment_amount: null,
  excess_amount: 2500,
  claim_deadline: '2026-01-15',
  claim_period_elapsed: true,
  days_to_claim_deadline: -10,
  confirmed_date: null,
  deed_date: null,
  set_aside_date: null,
  refund_date: null,
  excess_application_filed_date: '2025-06-01',
  excess_denied_date: null,
  excess_paid_date: null,
  payout_ready: true,
  zestimate: null,
  zestimate_as_of: null,
  score: 80,
  owner_is_entity: false,
  counsel_status: 'clear',
  form_pack_status: 'signed',
  form_pack_url: null,
  surplus_fee_pct: 10,
  handoff_ready: false,
}

describe('Excess proceeds list', () => {
  it('shows the claim clock, badges, and a link to the Deal File', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('summary=ytd')) {
        return { ok: true, json: async () => ({ excessProceedsFeeIncome: 1200, excessProceedsRecovered: 12000 }) }
      }
      return { ok: true, json: async () => ({ files: [file] }) }
    }))

    render(<ExcessProceedsWorkspace />)

    expect(await screen.findByRole('link', { name: 'Ada Owner' })).toHaveAttribute('href', '/leads/lead-1')
    expect(screen.getByText('10 days past deadline')).toBeInTheDocument()
    expect(screen.getAllByText('Claim period elapsed').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Payout ready').length).toBeGreaterThan(1)
    expect(screen.getAllByText('Application filed').length).toBeGreaterThan(1)
    expect(screen.getByRole('button', { name: 'Call' })).toBeEnabled()
    await waitFor(() => expect(screen.getByText('$1,200')).toBeInTheDocument())
  })
})
