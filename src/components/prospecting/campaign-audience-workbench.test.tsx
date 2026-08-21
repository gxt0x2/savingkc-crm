/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CampaignAudienceWorkbench } from './campaign-audience-workbench'

const member = {
  id: 'member-1', leadId: 'lead-1', phone: '+18165550123', timezone: 'America/Chicago', status: 'active' as const,
  suppressionReason: null, currentStepPosition: 1, nextActionAt: '2026-08-22T15:00:00.000Z', enrolledAt: '2026-08-21T15:00:00.000Z',
  lead: { fullName: 'Helen Seller', propertyAddress: '123 Main Street', station: 'prospect', classification: 'warm' },
}

afterEach(() => vi.unstubAllGlobals())

describe('CampaignAudienceWorkbench', () => {
  it('renders a bounded audience page and loads the next opaque cursor', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [member], pageInfo: { limit: 50, hasMore: true, nextCursor: 'next-50' } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ items: [{ ...member, id: 'member-2', lead: { ...member.lead, fullName: 'Alex Seller' } }], pageInfo: { limit: 50, hasMore: false, nextCursor: null } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignAudienceWorkbench campaignId="campaign-1" total={150} />)

    expect(await screen.findByText('Helen Seller')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Load 50 more/ }))
    expect(await screen.findByText('Alex Seller')).toBeVisible()
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('cursor=next-50'), expect.objectContaining({ cache: 'no-store' }))
  })

  it('reloads from the server when the operator changes status lanes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [member], pageInfo: { limit: 50, hasMore: false, nextCursor: null } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignAudienceWorkbench campaignId="campaign-1" total={150} />)
    await screen.findByText('Helen Seller')

    fireEvent.click(screen.getByRole('button', { name: 'Replied' }))
    expect(await screen.findByText('Helen Seller')).toBeVisible()
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('status=replied'), expect.objectContaining({ cache: 'no-store' })))
  })
})
