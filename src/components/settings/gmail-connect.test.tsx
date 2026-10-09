// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
    missing_scopes: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/calendar'],
    has_gmail_send: false,
    has_calendar: false,
    connection_status: 'connected',
    connection_error_code: null,
    connection_error_message: null,
    connection_checked_at: '2026-09-20T12:00:00.000Z',
    ...overrides,
  }
}

function statusResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

describe('GmailConnect honesty', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows a reconnect action for an expired grant without the privacy essay', async () => {
    fetchMock.mockResolvedValue(statusResponse({
      oauthConfigured: true,
      accounts: [account({
        connection_status: 'reauthorization_required',
        connection_error_code: 'invalid_grant',
        connection_error_message: 'Google authorization expired. Reconnect Gmail.',
      })],
    }))

    render(<GmailConnect userEmail="ernest@savingkc.com" />)

    expect(screen.queryByRole('link', { name: 'Privacy Policy' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Disconnect stops further Google API access/)).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reconnect Gmail' })).toBeInTheDocument())
    expect(screen.getByText('Authorization expired — reconnect Gmail')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect Gmail' })).not.toBeInTheDocument()
  })

  it('does not treat a stored account as healthy when OAuth env is missing', async () => {
    fetchMock.mockResolvedValue(statusResponse({
      oauthConfigured: false,
      accounts: [account()],
    }))

    render(<GmailConnect userEmail="ernest@savingkc.com" />)

    await waitFor(() => expect(screen.getByText(/Gmail OAuth is not configured/)).toBeInTheDocument())
    expect(screen.getByText('OAuth is not configured — this account is not connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Sync now' })).not.toBeInTheDocument()
  })

  it('warns when last_sync_at is older than 30 minutes instead of implying live sync', async () => {
    fetchMock.mockResolvedValue(statusResponse({
      oauthConfigured: true,
      accounts: [account({
        last_sync_at: new Date(Date.now() - 40 * 60 * 1000).toISOString(),
      })],
    }))

    render(<GmailConnect userEmail="ernest@savingkc.com" />)

    await waitFor(() => expect(screen.getByText(/Last sync is more than 30 minutes old/)).toBeInTheDocument())
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument()
  })

  it('shows one calendar line and hides the send harness when connected', async () => {
    fetchMock.mockResolvedValue(statusResponse({
      oauthConfigured: true,
      accounts: [account({
        last_sync_at: null,
        scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar',
        missing_scopes: [],
        has_gmail_send: true,
        has_calendar: true,
      })],
    }))

    render(<GmailConnect userEmail="ernest@savingkc.com" />)

    await waitFor(() => expect(screen.getByText('Connected')).toBeInTheDocument())
    expect(screen.getByText('ernest@savingkc.com')).toBeInTheDocument()
    expect(screen.getByText('Never synced')).toBeInTheDocument()
    expect(screen.getAllByText('Calendar sync on')).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Disconnect' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Connect Gmail' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send via Gmail' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Gmail recipient')).not.toBeInTheDocument()
    expect(screen.queryByText(/Google Calendar sync is on/)).not.toBeInTheDocument()
    expect(screen.queryByText(/We do not sell Google user data/)).not.toBeInTheDocument()
    expect(document.querySelector('.material-symbols-outlined')).toBeNull()
  })

  it('offers only Connect Gmail when nothing is connected', async () => {
    fetchMock.mockResolvedValue(statusResponse({
      oauthConfigured: true,
      accounts: [],
    }))

    render(<GmailConnect userEmail="ernest@savingkc.com" />)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeEnabled())
    expect(screen.getByRole('heading', { name: 'Gmail' })).toBeInTheDocument()
    expect(screen.getByText('Sync mail and calendar with your @savingkc.com Google account.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Disconnect' })).not.toBeInTheDocument()
    expect(screen.queryByText(/Privacy Policy/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send via Gmail' })).not.toBeInTheDocument()
  })

  it('syncs and disconnects through the existing Gmail endpoints', async () => {
    const user = userEvent.setup()
    const assign = vi.fn()
    vi.stubGlobal('location', { ...window.location, assign, origin: 'https://crm.savingkc.com', pathname: '/settings', search: '' })
    vi.spyOn(window, 'confirm').mockReturnValue(true)

    fetchMock.mockResolvedValue(statusResponse({
      oauthConfigured: true,
      accounts: [account({
        last_sync_at: null,
        scope: 'https://www.googleapis.com/auth/calendar',
        missing_scopes: [],
        has_calendar: true,
      })],
    }))

    render(<GmailConnect userEmail="ernest@savingkc.com" />)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sync now' })).toBeInTheDocument())

    fetchMock.mockResolvedValueOnce(statusResponse({ scanned: 4, matched: 1, inserted: 1 }))
    fetchMock.mockResolvedValueOnce(statusResponse({
      oauthConfigured: true,
      accounts: [account({ last_sync_at: new Date().toISOString(), missing_scopes: [], has_calendar: true, scope: 'calendar' })],
    }))

    await user.click(screen.getByRole('button', { name: 'Sync now' }))

    await waitFor(() => expect(screen.getByText('Scanned 4 emails · matched 1 · inserted 1')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledWith('/api/cron/sync-gmail/trigger', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ user_email: 'ernest@savingkc.com', days_back: 30 }),
    }))

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 200 }))
    fetchMock.mockResolvedValueOnce(statusResponse({ oauthConfigured: true, accounts: [] }))
    await user.click(screen.getByRole('button', { name: 'Disconnect' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Connect Gmail' })).toBeEnabled())
    expect(fetchMock).toHaveBeenCalledWith('/api/auth/google/disconnect', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ user_email: 'ernest@savingkc.com' }),
    }))

    await user.click(screen.getByRole('button', { name: 'Connect Gmail' }))
    expect(assign).toHaveBeenCalledWith('https://crm.savingkc.com/api/auth/google/authorize?return_to=%2Fsettings')
  })
})
