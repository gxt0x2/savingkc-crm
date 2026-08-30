/** @vitest-environment jsdom */

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountyParcelAudienceEnroll } from './county-parcel-audience-enroll'

afterEach(() => vi.unstubAllGlobals())

describe('CountyParcelAudienceEnroll', () => {
  it('posts the exact pasted Jackson parcel set and does not use a Saved View', async () => {
    const onEnrolled = vi.fn()
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ enrollment: { subjects: 2, eligible: 2, needsReview: 0, suppressed: 0, missing: 0 } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    render(<CountyParcelAudienceEnroll campaignId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" campaignKind="dialer" onEnrolled={onEnrolled} />)

    fireEvent.change(screen.getByRole('textbox', { name: 'Jackson parcel IDs' }), {
      target: { value: 'SYN-JACKSON-PARCEL-0001\nSYN-JACKSON-PARCEL-0002, SYN-JACKSON-PARCEL-0001' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Review 2 parcels' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add reviewed parcels' }))

    expect(await screen.findByRole('status')).toHaveTextContent('2 seller groups added with 2 ready to call')
    expect(onEnrolled).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/prospecting/campaigns/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/members',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          countyAudience: {
            parcelIds: ['SYN-JACKSON-PARCEL-0001', 'SYN-JACKSON-PARCEL-0002'],
            reviewedCount: 2,
          },
        }),
      }),
    )
    expect(String(fetchMock.mock.calls[0][1]?.body)).not.toContain('tax_3yr_plus')
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('5c45d2f7-c120-4477-bb1f-f04d69c4efdf')
  })

  it('keeps the review action disabled until a parcel list is present', () => {
    render(<CountyParcelAudienceEnroll campaignId="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" campaignKind="dialer" />)
    expect(screen.getByRole('button', { name: 'Review 0 parcels' })).toBeDisabled()
  })
})
