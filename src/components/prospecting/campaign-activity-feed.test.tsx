/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CampaignActivityFeed } from './campaign-activity-feed'

const firstPage = {
  items: [{
    id: 'event-1',
    eventType: 'campaign_action_sent',
    actor: 'Prospecting worker',
    memberId: 'member-1',
    actionId: 'action-1',
    status: 'sent',
    sellerName: 'Helen Seller',
    phone: '+18165550123',
    propertyAddress: '123 Main Street',
    body: 'Hi Helen, would you consider an offer?',
    errorCode: null,
    providerSid: 'SM123',
    occurredAt: '2026-08-21T20:00:00.000Z',
    scheduledAt: '2026-08-21T20:00:00.000Z',
    sentAt: '2026-08-21T20:00:01.000Z',
  }],
  pageInfo: { limit: 25, hasMore: true, nextCursor: 'next-page' },
}

afterEach(() => vi.unstubAllGlobals())

describe('CampaignActivityFeed', () => {
  it('shows seller-level delivery evidence from the bounded server feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => firstPage }))
    render(<CampaignActivityFeed campaignId="campaign-1" />)

    expect(await screen.findByText('Message sent')).toBeVisible()
    expect(screen.getByText('Helen Seller')).toBeVisible()
    expect(screen.getByText('Hi Helen, would you consider an offer?')).toBeVisible()
    expect(screen.getByText('123 Main Street')).toBeVisible()
    expect(screen.getByRole('button', { name: /Load older activity/ })).toBeVisible()
  })

  it('loads older rows with the opaque cursor and keeps the current feed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => firstPage })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        items: [{ ...firstPage.items[0], id: 'event-2', eventType: 'campaign_paused', sellerName: null, body: null, occurredAt: '2026-08-20T20:00:00.000Z' }],
        pageInfo: { limit: 25, hasMore: false, nextCursor: null },
      }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignActivityFeed campaignId="campaign-1" />)

    fireEvent.click(await screen.findByRole('button', { name: /Load older activity/ }))
    expect(await screen.findByText('Campaign paused')).toBeVisible()
    expect(screen.getByText('Message sent')).toBeVisible()
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('cursor=next-page'), { cache: 'no-store' })
  })

  it('surfaces unavailable history instead of presenting a false empty feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Campaign activity is unavailable' }) }))
    render(<CampaignActivityFeed campaignId="campaign-1" />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Campaign activity is unavailable'))
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument()
  })
})
