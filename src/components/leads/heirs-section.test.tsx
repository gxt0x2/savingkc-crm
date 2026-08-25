// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { HeirsSection } from './heirs-section'

const heirsPayload = {
  heirs: [
    {
      key: 'Angela::daughter',
      contact_name: 'Angela Taylor',
      relationship: 'daughter',
      address: null,
      unattempted_count: 1,
      phones: [
        {
          id: 'phone-fresh',
          prospect_id: 'prospect-1',
          number: '+18160000001',
          type: 'mobile',
          connected: null,
          attempted: false,
          last_disposition: null,
          last_attempt_at: null,
          is_verified_contact: false,
        },
        {
          id: 'phone-no-answer',
          prospect_id: 'prospect-1',
          number: '+18160000002',
          type: 'mobile',
          connected: null,
          attempted: true,
          last_disposition: 'no_answer',
          last_attempt_at: '2026-06-01T12:00:00.000Z',
          is_verified_contact: false,
        },
        {
          id: 'phone-disconnected',
          prospect_id: 'prospect-1',
          number: '+18160000003',
          type: 'mobile',
          connected: null,
          attempted: true,
          last_disposition: 'disconnected',
          last_attempt_at: '2026-06-01T12:00:00.000Z',
          is_verified_contact: false,
        },
        {
          id: 'phone-dnc',
          prospect_id: 'prospect-1',
          number: '+18160000006',
          type: 'mobile',
          connected: null,
          attempted: true,
          last_disposition: 'dnc',
          last_attempt_at: '2026-06-01T12:00:00.000Z',
          is_verified_contact: false,
        },
        {
          id: 'phone-wrong',
          prospect_id: 'prospect-1',
          number: '+18160000007',
          type: 'mobile',
          connected: null,
          attempted: true,
          last_disposition: 'wrong_number',
          last_attempt_at: '2026-06-01T12:00:00.000Z',
          is_verified_contact: false,
        },
      ],
    },
    {
      key: 'Ben::son',
      contact_name: 'Ben Taylor',
      relationship: 'son',
      address: null,
      unattempted_count: 1,
      phones: [
        {
          id: 'phone-verified',
          prospect_id: 'prospect-1',
          number: '+18160000004',
          type: 'mobile',
          connected: null,
          attempted: true,
          last_disposition: 'spoke_with_owner',
          last_attempt_at: '2026-06-01T12:00:00.000Z',
          is_verified_contact: true,
        },
        {
          id: 'phone-second-fresh',
          prospect_id: 'prospect-1',
          number: '+18160000005',
          type: 'mobile',
          connected: null,
          attempted: false,
          last_disposition: null,
          last_attempt_at: null,
          is_verified_contact: false,
        },
      ],
    },
  ],
  last_skip_traced_at: '2026-06-01T12:00:00.000Z',
}

function mockHeirsFetch() {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    json: async () => heirsPayload,
  }))
}

function renderHeirsSection(props: Partial<React.ComponentProps<typeof HeirsSection>> = {}) {
  return render(
    <HeirsSection
      leadId="lead-1"
      deceasedOwnerName="Mary Taylor"
      propertyAddress="123 Main St"
      defaultExpanded
      {...props}
    />,
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('HeirsSection dial queue', () => {
  it('keeps calling-floor readiness compact beside the primary phone action', async () => {
    mockHeirsFetch()
    renderHeirsSection({ collapsible: false })

    const heading = await screen.findByRole('heading', { name: /Callable people/i })
    expect(heading).toBeVisible()
    expect(heading).toHaveTextContent(/2 people · 4 ready · 1 verified/i)
    expect(screen.queryByLabelText('Calling queue readiness')).not.toBeInTheDocument()
    expect(screen.queryByText('People found')).not.toBeInTheDocument()
    expect(screen.queryByText('Ready numbers')).not.toBeInTheDocument()
    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0)
  })

  it('keeps every associated phone visible at once on the agent calling floor', async () => {
    mockHeirsFetch()
    renderHeirsSection({ collapsible: false, showAllPhones: true })

    expect(await screen.findByText('(816) 000-0001')).toBeVisible()
    expect(screen.getByText('(816) 000-0002')).toBeVisible()
    expect(screen.getByText('(816) 000-0003')).toBeVisible()
    expect(screen.getByText('(816) 000-0004')).toBeVisible()
    expect(screen.getByText('(816) 000-0005')).toBeVisible()
    expect(screen.getByText('(816) 000-0006')).toBeVisible()
    expect(screen.getByText('(816) 000-0007')).toBeVisible()
  })

  it('shows where the full phone run starts in preview without enabling calling', async () => {
    mockHeirsFetch()
    renderHeirsSection({ collapsible: false, showAllPhones: true, readOnlyPreview: true })

    expect(await screen.findByRole('button', { name: 'Call all 4 numbers' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Call all 4 numbers' })).toHaveAttribute(
      'title',
      'Available after this calling workflow is released to production',
    )
    expect(screen.getByRole('button', { name: 'Call 2 numbers for Angela Taylor' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Call 2 numbers for Ben Taylor' })).toBeDisabled()
    expect(screen.getAllByText('Call 2 numbers')).toHaveLength(2)
  })

  it('labels each person-level phone run with its exact eligible number count', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        heirs: [
          {
            key: 'Lillie::owner',
            contact_name: 'Lillie Williams',
            relationship: 'owner',
            address: null,
            unattempted_count: 2,
            phones: heirsPayload.heirs[0].phones.slice(0, 2),
          },
          {
            key: 'Quentin::unknown',
            contact_name: 'Quentin Williams',
            relationship: 'unknown',
            address: null,
            unattempted_count: 1,
            phones: [heirsPayload.heirs[1].phones[1]],
          },
        ],
      }),
    }))

    renderHeirsSection({ collapsible: false, showAllPhones: true, readOnlyPreview: true })

    expect(await screen.findByRole('button', { name: 'Call 2 numbers for Lillie Williams' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Call 1 number for Quentin Williams' })).toBeDisabled()
    expect(screen.getByText('Call 2 numbers')).toBeVisible()
    expect(screen.getByText('Call 1 number')).toBeVisible()
  })

  it('queues every callable listed heir phone, including attempted and verified numbers', async () => {
    mockHeirsFetch()
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('open-dialer-queue', onQueue)

    renderHeirsSection()

    const callButton = await screen.findByRole('button', { name: 'Call all 4 numbers' })
    fireEvent.click(callButton)

    await waitFor(() => expect(queueEvents).toHaveLength(1))
    expect(queueEvents[0].detail.queue.map((item: { prospect_phone_id: string }) => item.prospect_phone_id)).toEqual([
      'phone-fresh',
      'phone-no-answer',
      'phone-second-fresh',
      'phone-verified',
    ])
    expect(queueEvents[0].detail.queue.map((item: { leadId: string }) => item.leadId)).toEqual([
      'lead-1',
      'lead-1',
      'lead-1',
      'lead-1',
    ])

    window.removeEventListener('open-dialer-queue', onQueue)
  })

  it('queues associated phones for an unpromoted source Prospect without a Lead ID', async () => {
    mockHeirsFetch()
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('open-dialer-queue', onQueue)

    renderHeirsSection({ leadId: null, prospectId: 'prospect-1', campaignMemberId: 'member-1', showAllPhones: true })

    fireEvent.click(await screen.findByRole('button', { name: 'Call all 4 numbers' }))
    await waitFor(() => expect(queueEvents).toHaveLength(1))

    expect(fetch).toHaveBeenCalledWith('/api/heirs?prospect_id=prospect-1&campaign_member_id=member-1')
    expect(screen.getByText('(816) 000-0001')).toBeVisible()
    expect(screen.getByText('(816) 000-0005')).toBeVisible()
    expect(queueEvents[0].detail.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({
        leadId: null,
        prospectId: 'prospect-1',
        campaignMemberId: 'member-1',
      }),
    ]))
    expect(screen.queryByRole('button', { name: /skip trace/i })).not.toBeInTheDocument()
    window.removeEventListener('open-dialer-queue', onQueue)
  })

  it('keeps a reviewed Lead-primary snapshot callable without inventing source-phone provenance', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        heirs: [{
          key: 'Owner::owner',
          contact_name: 'Original Owner',
          relationship: 'owner',
          address: null,
          unattempted_count: 1,
          phones: [{
            id: 'snapshot-owner',
            snapshot_id: 'snapshot-owner',
            prospect_id: null,
            prospect_phone_id: null,
            number: '+18165550109',
            type: 'mobile',
            connected: null,
            status: 'ready',
            attempted: false,
            last_disposition: null,
            last_attempt_at: null,
          }],
        }],
      }),
    }))
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('open-dialer-queue', onQueue)

    renderHeirsSection({ campaignMemberId: 'member-lead-1' })
    fireEvent.click(await screen.findByRole('button', { name: 'Call all 1 number' }))
    await waitFor(() => expect(queueEvents).toHaveLength(1))

    expect(queueEvents[0].detail.queue[0]).toMatchObject({
      leadId: 'lead-1',
      prospectId: null,
      prospect_phone_id: null,
      campaignMemberId: 'member-lead-1',
    })
    expect(screen.queryByLabelText('Verify this number')).not.toBeInTheDocument()
    window.removeEventListener('open-dialer-queue', onQueue)
  })

  it('auto-starts the next property with the full callable heir queue', async () => {
    mockHeirsFetch()
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('open-dialer-queue', onQueue)

    renderHeirsSection({ autoStart: true })

    await waitFor(() => expect(queueEvents).toHaveLength(1))
    expect(queueEvents[0].detail.autoDial).toBe(true)
    expect(queueEvents[0].detail.queue.map((item: { prospect_phone_id: string }) => item.prospect_phone_id)).toEqual([
      'phone-fresh',
      'phone-no-answer',
      'phone-second-fresh',
      'phone-verified',
    ])

    window.removeEventListener('open-dialer-queue', onQueue)
  })

  it('keeps hard-stop phones visible but prevents disconnected, DNC, and wrong numbers from being queued manually', async () => {
    mockHeirsFetch()
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('open-dialer-queue', onQueue)

    renderHeirsSection()
    fireEvent.click(await screen.findByText('Angela Taylor'))
    const blocked = screen.getAllByRole('button', { name: 'Calling blocked for this number' })

    expect(blocked).toHaveLength(3)
    blocked.forEach((button) => {
      expect(button).toBeDisabled()
      fireEvent.click(button)
    })
    expect(queueEvents).toHaveLength(0)

    window.removeEventListener('open-dialer-queue', onQueue)
  })
})
