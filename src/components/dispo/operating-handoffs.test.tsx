/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DepartmentHandoffQueue } from './department-handoff-queue'
import { FalloutDialog } from './fallout-dialog'
import type { DispoDeal } from '@/types/dispo'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('seller-to-close operator handoffs', () => {
  it('shows a signed seller handoff and accepts it without a client actor field', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ handoffs: [{
        id: 'handoff-1', lead_id: 'lead-1', from_department: 'acquisitions', to_department: 'dispositions',
        status: 'pending', reason: 'Seller contract signed', evidence_type: 'seller_contract_signed',
        created_at: '2026-08-23T18:00:00Z', accepted_by: null,
        leads: { id: 'lead-1', full_name: 'Seller One', property_address: '123 Main St', city: 'Kansas City', state: 'MO' },
      }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ handoff: { id: 'handoff-1', status: 'accepted' } }) })
    vi.stubGlobal('fetch', fetchMock)

    render(<DepartmentHandoffQueue department="dispositions" title="Signed seller contracts waiting for Dispositions" />)
    expect(await screen.findByText('123 Main St')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Accept handoff' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    const request = fetchMock.mock.calls[1]
    expect(request[0]).toBe('/api/department-handoffs')
    expect(JSON.parse(request[1].body)).toEqual({ handoffId: 'handoff-1', action: 'accept' })
  })

  it('requires a reason, evidence, facts, and explicit confirmation before verified fallout', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ deal: { id: 'deal-1' } }) })
    vi.stubGlobal('fetch', fetchMock)
    const deal = {
      id: 'deal-1', lead_id: 'lead-1', stage: 'under_contract', entered_at: '2026-08-20T12:00:00Z',
      assignment_fee: 20000, close_date: null, accepted_offer_id: null, accepted_buyer_id: null,
      notes: null, created_at: '2026-08-20T12:00:00Z', updated_at: '2026-08-20T12:00:00Z',
      lead: { id: 'lead-1', full_name: 'Seller One', property_address: '123 Main St', city: 'Kansas City', state: 'MO', zip: '64110', arv: null, offer_amount: null, property_type: null, beds: null, baths_full: null, sqft: null },
    } satisfies DispoDeal

    render(<FalloutDialog deal={deal} onClose={() => undefined} onSaved={() => undefined} />)
    const submit = screen.getByRole('button', { name: 'Confirm verified fallout' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'title_issue' } })
    fireEvent.change(screen.getByPlaceholderText(/Cancellation email/), { target: { value: 'Title email dated 2026-08-23' } })
    fireEvent.change(screen.getByPlaceholderText(/Record the facts/), { target: { value: 'Title company confirmed an incurable defect.' } })
    fireEvent.click(screen.getByRole('checkbox'))
    expect(submit.disabled).toBe(false)
    fireEvent.click(submit)

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce())
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toEqual({
      action: 'record_fallout', reason: 'title_issue',
      notes: 'Title company confirmed an incurable defect.', evidenceReference: 'Title email dated 2026-08-23',
    })
    expect(body).not.toHaveProperty('actor')
  })
})
