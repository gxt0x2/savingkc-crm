// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { RecordOfferModal } from './record-offer-modal'

describe('record offer modal', () => {
  beforeEach(() => {
    vi.stubGlobal('crypto', { randomUUID: () => '11111111-1111-4111-8111-111111111111' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('reuses one idempotency key when an atomic save is retried', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Temporarily unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ success: true }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    const onSaved = vi.fn()
    const onClose = vi.fn()

    render(<RecordOfferModal leadId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" leadName="Test Seller" currentAmount={null} onSaved={onSaved} onClose={onClose} />)
    fireEvent.change(screen.getByLabelText('Offer amount'), { target: { value: '125000' } })
    fireEvent.click(screen.getByRole('button', { name: 'Record offer' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Temporarily unavailable')

    fireEvent.click(screen.getByRole('button', { name: 'Record offer' }))
    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1))

    expect(fetchMock).toHaveBeenCalledTimes(2)
    for (const [, options] of fetchMock.mock.calls) {
      expect(options.headers).toMatchObject({ 'Idempotency-Key': '11111111-1111-4111-8111-111111111111' })
    }
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
