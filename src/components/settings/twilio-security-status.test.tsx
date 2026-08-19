// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TwilioSecurityStatus } from './twilio-security-status'

const fetchMock = vi.fn()

describe('TwilioSecurityStatus', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('shows valid credentials while clearly blocking an active bypass', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      configuration: {
        accountSidConfigured: true,
        apiKeySidConfigured: true,
        apiKeySecretConfigured: true,
        authTokenConfigured: true,
        credentialMode: 'auth_token',
      },
      signatureValidation: { bypassEnabled: true },
      accountApi: { status: 'valid', credentialsValid: true },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }))

    render(<TwilioSecurityStatus />)

    expect(screen.getByRole('status')).toHaveTextContent('Checking Twilio security')
    await waitFor(() => expect(screen.getByText('Valid')).toBeInTheDocument())
    expect(screen.getByText('Bypass enabled')).toBeInTheDocument()
    expect(screen.getByText('blocked')).toBeInTheDocument()
  })

  it('shows the enforced healthy state', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      configuration: {
        accountSidConfigured: true,
        apiKeySidConfigured: true,
        apiKeySecretConfigured: true,
        authTokenConfigured: true,
        credentialMode: 'auth_token',
      },
      signatureValidation: { bypassEnabled: false },
      accountApi: { status: 'valid', credentialsValid: true },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(<TwilioSecurityStatus />)

    await waitFor(() => expect(screen.getByText('healthy')).toBeInTheDocument())
    expect(screen.getByText('Enforced')).toBeInTheDocument()
  })

  it.each([
    ['invalid_credentials', 'Invalid', 'Twilio rejected the configured Account SID or Auth Token.'],
    ['not_configured', 'Not configured', 'The Account SID and Auth Token are not both configured.'],
    ['unavailable', 'Provider unavailable', 'Twilio could not be reached or returned an unexpected response.'],
  ] as const)('explains the %s credential state accurately', async (accountStatus, label, detail) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      ok: false,
      configuration: {
        accountSidConfigured: accountStatus !== 'not_configured',
        apiKeySidConfigured: false,
        apiKeySecretConfigured: false,
        authTokenConfigured: accountStatus !== 'not_configured',
        credentialMode: accountStatus === 'not_configured' ? 'not_configured' : 'auth_token',
      },
      signatureValidation: { bypassEnabled: true },
      accountApi: { status: accountStatus, credentialsValid: accountStatus === 'invalid_credentials' ? false : null },
    }), { status: 503, headers: { 'Content-Type': 'application/json' } }))

    render(<TwilioSecurityStatus />)

    await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument())
    expect(screen.getByText(detail)).toBeInTheDocument()
  })

  it('can retry after a transient failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ok: true,
        configuration: {
          accountSidConfigured: true,
          apiKeySidConfigured: true,
          apiKeySecretConfigured: true,
          authTokenConfigured: true,
          credentialMode: 'auth_token',
        },
        signatureValidation: { bypassEnabled: false },
        accountApi: { status: 'valid', credentialsValid: true },
      }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    render(<TwilioSecurityStatus />)

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: 'Recheck' }))
    await waitFor(() => expect(screen.getByText('healthy')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
