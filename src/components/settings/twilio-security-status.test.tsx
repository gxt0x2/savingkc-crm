// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
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
})
