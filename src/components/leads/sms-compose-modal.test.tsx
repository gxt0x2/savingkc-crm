/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { email: 'ernest@savingkc.com' } }),
}))

import { SmsComposeModal } from './sms-compose-modal'

describe('SmsComposeModal Dialer operation control', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('leases both text and email writes without changing non-control payloads', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url === '/api/leads/lead-1/activities?limit=100') {
        return { ok: true, json: async () => ({ activities: [] }) }
      }
      if (url === '/api/sms-templates') return { ok: true, json: async () => ({ templates: [] }) }
      if (url === '/api/dialer/sessions/session-1/control/operations') {
        return { ok: true, json: async () => ({ control: { operationActive: init?.method === 'POST' } }) }
      }
      if (url === '/api/conversations/send') return { ok: true, status: 200, json: async () => ({ success: true }) }
      throw new Error(`Unexpected request ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<SmsComposeModal
      lead={{
        id: 'lead-1',
        full_name: 'Helen Seller',
        phone: '+18165550123',
        email: 'helen@example.com',
        property_address: '123 Main Street',
        assigned_agent: null,
      }}
      dialerSessionId="session-1"
      conversationSource="heir_dialer"
      onClose={vi.fn()}
    />)

    const textComposer = screen.getByPlaceholderText('Type a message…')
    fireEvent.change(textComposer, { target: { value: 'Text from the calling floor.' } })
    fireEvent.keyDown(textComposer, { key: 'Enter', metaKey: true })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/conversations/send')).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Email' }))
    fireEvent.change(screen.getByPlaceholderText('Type your email…'), { target: { value: 'Email from the calling floor.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Email' }))
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input) === '/api/conversations/send')).toHaveLength(2))

    const sends = fetchMock.mock.calls.filter(([input]) => String(input) === '/api/conversations/send')
    for (const [, request] of sends) {
      expect(request?.headers).toEqual(expect.objectContaining({
        'X-Dialer-Controller': expect.any(String),
        'X-Dialer-Operation': expect.any(String),
      }))
      expect(request?.signal).toBeInstanceOf(AbortSignal)
      expect(JSON.parse(String(request?.body))).toMatchObject({
        leadId: 'lead-1',
        dialerSessionId: 'session-1',
      })
    }
    expect(JSON.parse(String(sends[0]?.[1]?.body))).toMatchObject({ mode: 'sms', source: 'heir_dialer' })
    expect(JSON.parse(String(sends[1]?.[1]?.body))).toMatchObject({ mode: 'email', to: 'helen@example.com' })
    await waitFor(() => expect(fetchMock.mock.calls.filter(([input]) => String(input).includes('/control/operations'))).toHaveLength(4))
  })
})
