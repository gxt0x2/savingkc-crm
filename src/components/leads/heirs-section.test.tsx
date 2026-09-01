// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
    expect(screen.queryByText(/auto-advances through queue/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/All heir phones attempted/i)).not.toBeInTheDocument()
  })

  it('saves a durable note for the selected associated contact', async () => {
    const onContactNoteSaved = vi.fn()
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/heirs?')) return { ok: true, json: async () => heirsPayload }
      if (url === '/api/dialer/sessions/session-1/control/operations') {
        return { ok: true, json: async () => ({ control: { operationActive: init?.method === 'POST' } }) }
      }
      if (url === '/api/prospecting/contact-notes' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ activity: { id: 'activity-1' } }) }
      }
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderHeirsSection({
      showAllPhones: true,
      campaignMemberId: 'member-1',
      dialerSessionId: 'session-1',
      onContactNoteSaved,
    })

    const note = await screen.findByLabelText('Note for Angela Taylor')
    fireEvent.change(note, { target: { value: 'Sister handles the estate calls.' } })
    fireEvent.click(within(note.closest('form')!).getByRole('button', { name: 'Save note' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/prospecting/contact-notes', expect.objectContaining({ method: 'POST' })))
    const request = fetchMock.mock.calls.find(([url]) => String(url) === '/api/prospecting/contact-notes')
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      leadId: 'lead-1',
      campaignMemberId: 'member-1',
      dialerSessionId: 'session-1',
      contactKey: 'Angela::daughter',
      contactName: 'Angela Taylor',
      relation: 'daughter',
      description: 'Sister handles the estate calls.',
    })
    expect(request?.[1]?.headers).toEqual(expect.objectContaining({
      'X-Dialer-Controller': expect.any(String),
      'X-Dialer-Operation': expect.any(String),
    }))
    expect(request?.[1]?.signal).toBeInstanceOf(AbortSignal)
    const operationRequests = fetchMock.mock.calls.filter(([url]) => String(url).includes('/control/operations'))
    expect(operationRequests.map(([, init]) => init?.method)).toEqual(['POST', 'DELETE'])
    expect(JSON.parse(String(operationRequests[0]?.[1]?.body)).operationId)
      .toBe(JSON.parse(String(operationRequests[1]?.[1]?.body)).operationId)
    expect(await screen.findByText('Note saved to this contact.')).toBeVisible()
    expect(onContactNoteSaved).toHaveBeenCalledOnce()
  })

  it('scopes skip-trace and verification writes to the controlling dialer session', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('/api/heirs?')) return { ok: true, json: async () => heirsPayload }
      if (url === '/api/dialer/sessions/session-1/control/operations') {
        return { ok: true, json: async () => ({ control: { operationActive: init?.method === 'POST' } }) }
      }
      if (url === '/api/heirs/verify' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ verified: true }) }
      }
      if (url === '/api/heirs/sync' && init?.method === 'POST') {
        return { ok: true, json: async () => ({ synced: true }) }
      }
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    renderHeirsSection({ showAllPhones: true, dialerSessionId: 'session-1' })

    fireEvent.click((await screen.findAllByRole('button', { name: 'Verify this number' }))[0])
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/heirs/verify')).toBe(true))
    fireEvent.click(screen.getByRole('button', { name: 'Re-sync' }))
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => String(url) === '/api/heirs/sync')).toBe(true))

    for (const url of ['/api/heirs/verify', '/api/heirs/sync']) {
      const request = fetchMock.mock.calls.find(([input]) => String(input) === url)
      expect(request?.[1]?.headers).toEqual(expect.objectContaining({
        'X-Dialer-Controller': expect.any(String),
        'X-Dialer-Operation': expect.any(String),
      }))
      expect(request?.[1]?.signal).toBeInstanceOf(AbortSignal)
      expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({ dialerSessionId: 'session-1' })
    }
    const operationRequests = fetchMock.mock.calls.filter(([input]) => String(input).includes('/control/operations'))
    expect(operationRequests.map(([, init]) => init?.method)).toEqual(['POST', 'DELETE', 'POST', 'DELETE'])
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
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('prospecting-preview-queue-ready', onQueue)
    renderHeirsSection({ collapsible: false, showAllPhones: true, readOnlyPreview: true, autoStart: true })

    expect(await screen.findByRole('button', { name: 'Call all 4 numbers' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Call all 4 numbers' })).toHaveAttribute(
      'title',
      'Available after this calling workflow is released to production',
    )
    expect(screen.getByRole('button', { name: 'Call 2 numbers for Angela Taylor' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Call 2 numbers for Ben Taylor' })).toBeDisabled()
    expect(screen.getAllByText('Call 2 numbers')).toHaveLength(2)
    const previewNotes = screen.getAllByRole('textbox', { name: /Note for/i })
    expect(previewNotes).toHaveLength(2)
    previewNotes.forEach((note) => expect(note).toBeDisabled())
    expect(screen.getAllByRole('button', { name: 'Save note' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Verify this number' }).every((button) => button.hasAttribute('disabled'))).toBe(true)
    expect(screen.getAllByRole('button', { name: 'Send SMS' }).every((button) => button.hasAttribute('disabled'))).toBe(true)
    await waitFor(() => expect(queueEvents).toHaveLength(1))
    expect(queueEvents[0].detail.queue).toHaveLength(4)
    window.removeEventListener('prospecting-preview-queue-ready', onQueue)
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

  it('resumes automatic dialing after phone numbers already completed in this session', async () => {
    mockHeirsFetch()
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('open-dialer-queue', onQueue)

    renderHeirsSection({
      autoStart: true,
      autoStartSkipPhoneIds: ['phone-fresh', 'phone-no-answer'],
    })

    await waitFor(() => expect(queueEvents).toHaveLength(1))
    expect(queueEvents[0].detail.queue.map((item: { prospect_phone_id: string }) => item.prospect_phone_id)).toEqual([
      'phone-second-fresh',
      'phone-verified',
    ])

    window.removeEventListener('open-dialer-queue', onQueue)
  })

  it('uses the normalized number when a legacy phone snapshot has no source phone id', async () => {
    const legacyPayload = structuredClone(heirsPayload)
    Object.assign(legacyPayload.heirs[0].phones[0], { snapshot_id: 'snapshot-phone-1' })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => legacyPayload }))
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('open-dialer-queue', onQueue)

    renderHeirsSection({ autoStart: true, autoStartSkipPhones: ['(816) 000-0001'] })

    await waitFor(() => expect(queueEvents).toHaveLength(1))
    expect(queueEvents[0].detail.queue.map((item: { phone: string }) => item.phone)).not.toContain('+18160000001')
    window.removeEventListener('open-dialer-queue', onQueue)
  })

  it('queues the saved seller again exactly once after a new control epoch', async () => {
    mockHeirsFetch()
    const queueEvents: CustomEvent[] = []
    const onQueue = (event: Event) => queueEvents.push(event as CustomEvent)
    window.addEventListener('open-dialer-queue', onQueue)
    const view = renderHeirsSection({ autoStart: true, autoStartEpoch: 1 })

    await waitFor(() => expect(queueEvents).toHaveLength(1))
    view.rerender(<HeirsSection
      leadId="lead-1"
      deceasedOwnerName="Mary Taylor"
      propertyAddress="123 Main St"
      defaultExpanded
      autoStart={false}
      autoStartEpoch={1}
    />)
    view.rerender(<HeirsSection
      leadId="lead-1"
      deceasedOwnerName="Mary Taylor"
      propertyAddress="123 Main St"
      defaultExpanded
      autoStart
      autoStartEpoch={2}
    />)

    await waitFor(() => expect(queueEvents).toHaveLength(2))
    expect(queueEvents[1].detail.autoDial).toBe(true)
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
