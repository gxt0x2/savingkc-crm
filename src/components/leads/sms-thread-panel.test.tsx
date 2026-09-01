// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SmsThreadPanel } from './sms-thread-panel'

describe('SmsThreadPanel communication identity', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the active Dialer session sender ahead of an older thread line', () => {
    render(
      <SmsThreadPanel
        leadId="lead-1"
        leadName="Frank Hausback"
        phone="+19135307378"
        defaultFromPhone="+18163077835"
        activities={[
          {
            id: 'sms-1',
            activity_type: 'sms',
            description: 'Wrong number',
            agent: 'System',
            created_at: '2026-06-18T18:29:14.000Z',
            metadata: {
              direction: 'received',
              from: '+19135307378',
              to: '+18167277667',
            },
          },
        ]}
      />,
    )

    expect(screen.getByRole('combobox')).toHaveValue('+18163077835')
    expect(screen.getByText('Active dialer session')).toBeInTheDocument()
  })

  it('holds the Dialer operation lease around an inline Text Hub send', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/dialer/sessions/session-1/control/operations') {
        return { ok: true, json: async () => ({ control: { operationActive: init?.method === 'POST' } }) }
      }
      if (url === '/api/conversations/send') return { ok: true, json: async () => ({ success: true }) }
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(
      <SmsThreadPanel
        leadId="lead-1"
        leadName="Helen Seller"
        phone="+18165550123"
        defaultFromPhone="+18163077835"
        dialerSessionId="session-1"
        activities={[]}
      />,
    )

    const composer = screen.getByPlaceholderText('Type a text...')
    fireEvent.change(composer, { target: { value: 'Following up about your property.' } })
    fireEvent.keyDown(composer, { key: 'Enter', metaKey: true })

    await waitFor(() => expect(fetchMock.mock.calls.some(([input]) => String(input) === '/api/conversations/send')).toBe(true))
    const sendRequest = fetchMock.mock.calls.find(([input]) => String(input) === '/api/conversations/send')
    expect(sendRequest?.[1]?.headers).toEqual(expect.objectContaining({
      'X-Dialer-Controller': expect.any(String),
      'X-Dialer-Operation': expect.any(String),
    }))
    expect(sendRequest?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(JSON.parse(String(sendRequest?.[1]?.body))).toMatchObject({
      leadId: 'lead-1',
      dialerSessionId: 'session-1',
      body: 'Following up about your property.',
    })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/control/operations'))).toHaveLength(2))
  })
})
