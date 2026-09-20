import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  hasGoogleOAuthConfig: vi.fn(),
  getValidAccessTokenResult: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/gmail-sync', () => ({
  hasGoogleOAuthConfig: mocks.hasGoogleOAuthConfig,
  getValidAccessTokenResult: mocks.getValidAccessTokenResult,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

import {
  encodeRfc822Message,
  isValidEmailAddress,
  sendConnectedGmail,
  sendGmailMessage,
} from '@/lib/gmail-send'

const token = {
  id: 'tok-1',
  user_email: 'ernest@savingkc.com',
  access_token: 'access',
  refresh_token: 'refresh',
  expires_at: '2026-09-20T15:00:00.000Z',
  last_sync_at: null,
  scope: 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar',
}

describe('Gmail send helper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.hasGoogleOAuthConfig.mockReturnValue(true)
    mocks.getValidAccessTokenResult.mockResolvedValue({ accessToken: 'live-token', error: null })
  })

  it('encodes an RFC 822 message as Gmail raw base64url', () => {
    const raw = encodeRfc822Message({
      from: 'ernest@savingkc.com',
      to: 'seller@example.com',
      subject: 'Offer follow-up',
      text: 'Can we meet tomorrow?',
    })
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    expect(decoded).toContain('From: ernest@savingkc.com')
    expect(decoded).toContain('To: seller@example.com')
    expect(decoded).toContain('Subject: Offer follow-up')
    expect(decoded).toContain('Can we meet tomorrow?')
    expect(raw).not.toMatch(/[+/=]/)
  })

  it('rejects invalid recipients before calling Gmail', async () => {
    const fetchImpl = vi.fn()
    const result = await sendGmailMessage({
      accessToken: 'token',
      from: 'ernest@savingkc.com',
      to: 'not-an-email',
      subject: 'Hi',
      text: 'Hello',
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, code: 'invalid_recipient' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(isValidEmailAddress('seller@example.com')).toBe(true)
  })

  it('sends through users.messages.send and returns the Gmail id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      id: 'msg-1',
      threadId: 'thread-1',
    }), { status: 200 }))

    const result = await sendGmailMessage({
      accessToken: 'live-token',
      from: 'ernest@savingkc.com',
      to: 'seller@example.com',
      subject: 'Hello',
      text: 'From Saving KC',
      fetchImpl,
    })

    expect(result).toEqual({
      ok: true,
      id: 'msg-1',
      threadId: 'thread-1',
      from: 'ernest@savingkc.com',
    })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer live-token' }),
      }),
    )
  })

  it('fail-closes when no Google token is stored', async () => {
    const result = await sendConnectedGmail({
      userEmail: 'ernest@savingkc.com',
      to: 'seller@example.com',
      subject: 'Hello',
      text: 'Body',
      loadToken: async () => null,
      fetchImpl: vi.fn(),
    })
    expect(result).toMatchObject({ ok: false, code: 'no_token' })
    expect(result.ok === false && result.error).toMatch(/Connect Gmail/)
  })

  it('fail-closes when gmail.send is missing from the stored grant', async () => {
    const result = await sendConnectedGmail({
      userEmail: 'ernest@savingkc.com',
      to: 'seller@example.com',
      subject: 'Hello',
      text: 'Body',
      loadToken: async () => ({ ...token, scope: 'https://www.googleapis.com/auth/gmail.readonly' }),
      fetchImpl: vi.fn(),
    })
    expect(result).toMatchObject({ ok: false, code: 'missing_gmail_send' })
    expect(mocks.getValidAccessTokenResult).not.toHaveBeenCalled()
  })

  it('fail-closes when token refresh fails', async () => {
    mocks.getValidAccessTokenResult.mockResolvedValue({
      accessToken: null,
      error: 'reauthorization_required',
    })
    const fetchImpl = vi.fn()
    const result = await sendConnectedGmail({
      userEmail: 'ernest@savingkc.com',
      to: 'seller@example.com',
      subject: 'Hello',
      text: 'Body',
      loadToken: async () => token,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: false, code: 'reauthorization_required' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('uses a refreshed access token to send', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg-9' }), { status: 200 }))
    const result = await sendConnectedGmail({
      userEmail: 'ernest@savingkc.com',
      to: 'seller@example.com',
      subject: 'Hello',
      text: 'Body',
      loadToken: async () => token,
      fetchImpl,
    })
    expect(result).toMatchObject({ ok: true, id: 'msg-9' })
    expect(fetchImpl.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: 'Bearer live-token' })
  })
})
