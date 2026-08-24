// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CampaignSmsRecipientReview } from './campaign-sms-recipient-review'

afterEach(() => vi.unstubAllGlobals())

describe('CampaignSmsRecipientReview', () => {
  it('keeps review inert and saves exactly one eligible recipient', async () => {
    const onReviewed = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ contacts: [
          { id: 'ready', sourceKind: 'prospect_phone', prospectId: 'prospect', prospectPhoneId: 'phone', phone: '+19135550123', contactName: 'Avery', relationship: 'daughter', phoneType: 'mobile', status: 'ready', suppressionReason: null, selectedForSms: false },
          { id: 'blocked', sourceKind: 'prospect_phone', prospectId: 'prospect', prospectPhoneId: 'blocked-phone', phone: '+19135550124', contactName: 'Sam', relationship: 'son', phoneType: 'mobile', status: 'suppressed', suppressionReason: 'do_not_contact', selectedForSms: false },
        ] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ selection: { phone: '+19135550123' } }),
      })
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignSmsRecipientReview campaignId="campaign" memberId="member" label="Seller" onReviewed={onReviewed} />)

    fireEvent.click(screen.getByRole('button', { name: 'Review recipient' }))
    expect(await screen.findByText('Nothing sends until the campaign is separately activated.')).toBeVisible()
    expect(screen.getByRole('radio', { name: /Sam/ })).toBeDisabled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('radio', { name: /Avery/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Approve this recipient' }))
    await waitFor(() => expect(onReviewed).toHaveBeenCalledWith('+19135550123'))
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('/contacts'), expect.objectContaining({ method: 'PATCH' }))
  })
})
