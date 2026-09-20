// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GmailConnect } from './gmail-connect'

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
}))

const fetchMock = vi.fn()

function account(overrides: Record<string, unknown> = {}) {
  return {
    user_email: 'ernest@savingkc.com',
    last_sync_at: '2026-09-20T12:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    scope: 'gmail.readonly',
    connection_status: 'connected',
    connection_error_code: null,
    connection_error_message: null,
    connection_checked_at: '2026-09-20T12:00:00.000Z',
    ...overrides,
  }
}

describe('GmailConnect honesty', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows a red reconnect state for an expired grant', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      oauthConfigured: true,
      accounts: [account({
        connection_status: 'reauthorization_required',
        connection_error_code: 'invalid_grant',
        connection_error_message: 'Google authorization expired. Reconnect Gmail.',
      })],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(<GmailConnect userEmail="ernest@savingkc.com" />)

    await waitFor(() => expect(screen.getByText('Reconnect Gmail')).toBeInTheDocument())
    expect(screen.getByText('Authorization expired — reconnect Gmail')).toBeInTheDocument()
    expect(screen.queryByText('Sync now')).not.toBeInTheDocument()
  })

  it('does not treat a stored account as healthy when OAuth env is missing', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      oauthConfigured: false,
      accounts: [account()],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(<GmailConnect userEmail="ernest@savingkc.com" />)

    await waitFor(() => expect(screen.getByText(/Gmail OAuth is not configured/)).toBeInTheDocument())
    expect(screen.getByText('OAuth is not configured — this account is not connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeDisabled()
  })

  it('warns when last_sync_at is older than 36 hours instead of implying live sync', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      oauthConfigured: true,
      accounts: [account({
        last_sync_at: new Date(Date.now() - 40 * 60 * 60 * 1000).toISOString(),
      })],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(<GmailConnect userEmail="ernest@savingkc.com" />)

    await waitFor(() => expect(screen.getByText(/Last sync is more than 36 hours old/)).toBeInTheDocument())
    expect(screen.getByText('Sync now')).toBeInTheDocument()
  })
})
