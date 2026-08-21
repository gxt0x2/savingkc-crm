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
  it('shows calling-floor readiness when embedded as the primary workspace', async () => {
    mockHeirsFetch()
    renderHeirsSection({ collapsible: false })

    expect(await screen.findByRole('heading', { name: /Callable people/i })).toBeVisible()
    expect(screen.getByLabelText('Calling queue readiness')).toBeVisible()
    expect(screen.getByText('People found')).toBeVisible()
    expect(screen.getByText('Ready numbers')).toBeVisible()
    expect(screen.getAllByText('Verified').length).toBeGreaterThan(0)
  })

  it('queues every callable listed heir phone, including attempted and verified numbers', async () => {
    mockHeirsFetch()
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('open-dialer-queue', onQueue)

    renderHeirsSection()

    const callButton = await screen.findByRole('button', { name: /Call heirs \(4\)/i })
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
