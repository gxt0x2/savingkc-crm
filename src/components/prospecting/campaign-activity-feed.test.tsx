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
    leadId: '11111111-1111-4111-8111-111111111111',
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

    expect(await screen.findByText('Provider accepted')).toBeVisible()
    expect(screen.getByText('Helen Seller')).toBeVisible()
    expect(screen.getByText('Hi Helen, would you consider an offer?')).toBeVisible()
    expect(screen.getByText('123 Main Street')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', '/conversations?lead=11111111-1111-4111-8111-111111111111')
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
    expect(screen.getByText('Provider accepted')).toBeVisible()
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('cursor=next-page'), { cache: 'no-store' })
  })

  it('switches to server-owned operator filters and resets the prior feed', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => firstPage })
      .mockResolvedValueOnce({ ok: true, json: async () => ({
        items: [{ ...firstPage.items[0], id: 'failure', eventType: 'campaign_action_failed', status: 'failed', errorCode: '30007' }],
        pageInfo: { limit: 25, hasMore: false, nextCursor: null },
      }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignActivityFeed campaignId="campaign-1" />)

    expect(await screen.findByText('Provider accepted')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Failures' }))

    expect(await screen.findByText('Delivery failed')).toBeVisible()
    expect(screen.queryByText('Provider accepted')).not.toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('filter=failures'), { cache: 'no-store' })
  })

  it('shows a truthful empty state for the selected filter', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => firstPage })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [], pageInfo: { limit: 25, hasMore: false, nextCursor: null } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignActivityFeed campaignId="campaign-1" />)

    expect(await screen.findByText('Provider accepted')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Replies' }))
    expect(await screen.findByText('No replies yet')).toBeVisible()
  })

  it('distinguishes carrier delivery from provider acceptance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      items: [{ ...firstPage.items[0], eventType: 'campaign_action_delivered', status: 'delivered' }],
      pageInfo: { limit: 25, hasMore: false, nextCursor: null },
    }) }))
    render(<CampaignActivityFeed campaignId="campaign-1" />)
    expect(await screen.findByText('Carrier delivered')).toBeVisible()
  })

  it('shows the seller reply and hands it to the authoritative inbox', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      items: [{ ...firstPage.items[0], eventType: 'campaign_member_replied', actionId: null, status: null, body: 'Yes, I would consider an offer.' }],
      pageInfo: { limit: 25, hasMore: false, nextCursor: null },
    }) }))
    render(<CampaignActivityFeed campaignId="campaign-1" />)

    expect(await screen.findByText('Seller replied')).toBeVisible()
    expect(screen.getByText('Yes, I would consider an offer.')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', '/conversations?lead=11111111-1111-4111-8111-111111111111')
  })

  it('names dialer batches and saved call outcomes in operator language', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      items: [
        { ...firstPage.items[0], id: 'batch', eventType: 'dialer_batch_started', sellerName: null, body: null },
        { ...firstPage.items[0], id: 'outcome', eventType: 'member_call_completed', body: null },
      ],
      pageInfo: { limit: 25, hasMore: false, nextCursor: null },
    }) }))
    render(<CampaignActivityFeed campaignId="campaign-1" />)

    expect(await screen.findByText('Calling batch started')).toBeVisible()
    expect(screen.getByText('Call outcome saved')).toBeVisible()
  })

  it('surfaces unavailable history instead of presenting a false empty feed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: 'Campaign activity is unavailable' }) }))
    render(<CampaignActivityFeed campaignId="campaign-1" />)

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Campaign activity is unavailable'))
    expect(screen.queryByText('No activity yet')).not.toBeInTheDocument()
  })
})
