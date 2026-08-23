/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('./county-audience-inventory', () => ({ CountyAudienceInventory: () => <div>County inventory</div> }))
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
    render(<CampaignAudienceWorkbench campaignId="campaign-1" campaignName="August Absentee" total={150} canEditAudience />)

    expect(await screen.findByText('Helen Seller')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open conversation with Helen Seller' })).toHaveAttribute('href', '/conversations?lead=lead-1')
    fireEvent.click(screen.getByRole('button', { name: /Load 50 more/ }))
    expect(await screen.findByText('Alex Seller')).toBeVisible()
    expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('cursor=next-50'), expect.objectContaining({ cache: 'no-store' }))
  })

  it('reloads from the server when the operator changes status lanes', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [member], pageInfo: { limit: 50, hasMore: false, nextCursor: null } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignAudienceWorkbench campaignId="campaign-1" campaignName="August Absentee" total={150} canEditAudience />)
    await screen.findByText('Helen Seller')

    fireEvent.click(screen.getByRole('button', { name: 'Replied' }))
    expect(await screen.findByText('Helen Seller')).toBeVisible()
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('status=replied'), expect.objectContaining({ cache: 'no-store' })))
  })

  it('debounces search against the entire server-side campaign audience', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ items: [member], pageInfo: { limit: 50, hasMore: false, nextCursor: null } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignAudienceWorkbench campaignId="campaign-1" campaignName="August Absentee" total={150} canEditAudience />)
    await screen.findByText('Helen Seller')

    expect(screen.getByText(/Search all 150 contacts/)).toBeVisible()
    fireEvent.change(screen.getByRole('textbox', { name: 'Search entire campaign audience' }), { target: { value: '  Helen   Seller ' } })
    expect(screen.getByRole('status')).toHaveTextContent('Searching the full campaign audience')
    await waitFor(() => expect(fetchMock).toHaveBeenLastCalledWith(expect.stringContaining('q=helen+seller'), expect.objectContaining({ cache: 'no-store' })), { timeout: 1_000 })
  })

  it('requires confirmation, removes one member, and refreshes campaign totals', async () => {
    const onAudienceChanged = vi.fn()
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => init?.method === 'DELETE'
      ? { ok: true, json: async () => ({ member: { id: member.id, status: 'removed', removed: true, cancelledActions: 1 } }) }
      : { ok: true, json: async () => ({ items: [member], pageInfo: { limit: 50, hasMore: false, nextCursor: null } }) })
    vi.stubGlobal('fetch', fetchMock)
    render(<CampaignAudienceWorkbench campaignId="campaign-1" campaignName="August Absentee" total={1} canEditAudience onAudienceChanged={onAudienceChanged} />)

    fireEvent.click(await screen.findByRole('button', { name: 'Remove Helen Seller from campaign' }))
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Helen Seller was removed')
    expect(screen.queryByText('Helen Seller')).not.toBeInTheDocument()
    expect(onAudienceChanged).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/prospecting/campaigns/campaign-1/members', expect.objectContaining({
      method: 'DELETE',
      body: JSON.stringify({ memberId: member.id }),
    }))
  })
})
