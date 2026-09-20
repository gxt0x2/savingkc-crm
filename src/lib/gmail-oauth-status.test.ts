import { describe, expect, it, vi } from 'vitest'
import { evaluateGoogleAccounts } from '@/lib/gmail-oauth-health'
import {
  hasNonEmptyRefreshToken,
  isGmailSyncStale,
  mapGmailHealthSnapshot,
  resolveGoogleAccountConnection,
} from '@/lib/gmail-oauth-status'

const now = '2026-09-20T14:00:00.000Z'
const checkedAt = '2026-09-20T13:00:00.000Z'

function health(status: 'connected' | 'reauthorization_required' | 'error', errorCode: string | null = null) {
  return {
    status,
    errorCode,
    errorMessage: errorCode,
    checkedAt,
  }
}

describe('Gmail OAuth fail-closed status', () => {
  it('never treats a missing health row as connected', () => {
    const resolved = resolveGoogleAccountConnection({
      oauthConfigured: true,
      hasRefreshToken: true,
      health: null,
      now,
    })

    expect(resolved.connection_status).not.toBe('connected')
    expect(resolved.connection_status).toBe('error')
    expect(resolved.connection_error_code).toBe('connection_unverified')
    expect(resolved.shouldProbe).toBe(true)
  })

  it('requires a stored refresh token before Connected', () => {
    const resolved = resolveGoogleAccountConnection({
      oauthConfigured: true,
      hasRefreshToken: false,
      health: health('connected'),
      now,
    })

    expect(resolved.connection_status).toBe('reauthorization_required')
    expect(resolved.connection_error_code).toBe('missing_refresh_token')
    expect(resolved.shouldProbe).toBe(false)
    expect(resolved.persist?.status).toBe('reauthorization_required')
  })

  it('keeps accounts unhealthy when OAuth env is missing', () => {
    const resolved = resolveGoogleAccountConnection({
      oauthConfigured: false,
      hasRefreshToken: true,
      health: health('connected'),
      probe: { ok: true, errorCode: null, errorMessage: null },
      now,
    })

    expect(resolved.connection_status).toBe('error')
    expect(resolved.connection_error_code).toBe('google_oauth_not_configured')
    expect(resolved.shouldProbe).toBe(false)
  })

  it('returns connected only when health is already connected and a refresh token exists', () => {
    const resolved = resolveGoogleAccountConnection({
      oauthConfigured: true,
      hasRefreshToken: true,
      health: health('connected'),
      now,
    })

    expect(resolved).toMatchObject({
      connection_status: 'connected',
      connection_error_code: null,
      connection_error_message: null,
      shouldProbe: false,
      persist: null,
    })
  })

  it('returns connected after a successful lightweight probe when health is missing', () => {
    const resolved = resolveGoogleAccountConnection({
      oauthConfigured: true,
      hasRefreshToken: true,
      health: null,
      probe: { ok: true, errorCode: null, errorMessage: null },
      now,
    })

    expect(resolved.connection_status).toBe('connected')
    expect(resolved.persist).toEqual({ status: 'connected', errorCode: null, errorMessage: null })
  })

  it('maps invalid_grant probe failures to reauthorization_required', () => {
    const resolved = resolveGoogleAccountConnection({
      oauthConfigured: true,
      hasRefreshToken: true,
      health: null,
      probe: { ok: false, errorCode: 'invalid_grant', errorMessage: 'Token has been expired or revoked.' },
      now,
    })

    expect(resolved.connection_status).toBe('reauthorization_required')
    expect(resolved.connection_error_code).toBe('invalid_grant')
    expect(resolved.persist?.status).toBe('reauthorization_required')
  })

  it('preserves a known reauthorization_required health row without probing', () => {
    const resolved = resolveGoogleAccountConnection({
      oauthConfigured: true,
      hasRefreshToken: true,
      health: health('reauthorization_required', 'invalid_grant'),
      now,
    })

    expect(resolved.connection_status).toBe('reauthorization_required')
    expect(resolved.shouldProbe).toBe(false)
  })
})

describe('evaluateGoogleAccounts', () => {
  it('probes unverified grants and persists invalid_grant as reauthorization_required', async () => {
    const persist = vi.fn()
    const probe = vi.fn().mockResolvedValue({
      ok: false,
      errorCode: 'invalid_grant',
      errorMessage: 'Token has been expired or revoked.',
    })

    const accounts = await evaluateGoogleAccounts({
      db: {} as never,
      oauthConfigured: true,
      now,
      readHealth: async () => null,
      probe,
      persist,
      accounts: [{
        id: 'tok-1',
        user_email: 'ernest@savingkc.com',
        last_sync_at: '2026-09-18T13:00:00.000Z',
        created_at: '2026-01-01T00:00:00.000Z',
        scope: 'gmail.readonly',
        refresh_token: 'stored-refresh',
        access_token: 'expired',
        expires_at: '2026-09-01T00:00:00.000Z',
      }],
    })

    expect(probe).toHaveBeenCalledTimes(1)
    expect(accounts[0]?.connection_status).toBe('reauthorization_required')
    expect(persist).toHaveBeenCalledWith({}, expect.objectContaining({
      provider: 'google',
      userEmail: 'ernest@savingkc.com',
      status: 'reauthorization_required',
      errorCode: 'invalid_grant',
    }))
  })

  it('does not claim connected when OAuth env is missing even if a token row exists', async () => {
    const probe = vi.fn()
    const accounts = await evaluateGoogleAccounts({
      db: {} as never,
      oauthConfigured: false,
      now,
      readHealth: async () => ({
        provider: 'google',
        userEmail: 'ernest@savingkc.com',
        status: 'connected',
        errorCode: null,
        errorMessage: null,
        checkedAt,
      }),
      probe,
      persist: vi.fn(),
      accounts: [{
        id: 'tok-1',
        user_email: 'ernest@savingkc.com',
        last_sync_at: now,
        created_at: now,
        refresh_token: 'stored-refresh',
      }],
    })

    expect(probe).not.toHaveBeenCalled()
    expect(accounts[0]?.connection_status).toBe('error')
    expect(accounts[0]?.connection_error_code).toBe('google_oauth_not_configured')
  })
})

describe('Gmail Andon health mapping', () => {
  it('surfaces configured, status, last_sync_at, and error code for a dead grant', () => {
    const snapshot = mapGmailHealthSnapshot({
      oauthConfigured: true,
      now: new Date(now),
      accounts: [{
        userEmail: 'ernest@savingkc.com',
        hasRefreshToken: true,
        lastSyncAt: '2026-09-18T13:15:00.000Z',
        health: health('reauthorization_required', 'invalid_grant'),
      }],
    })

    expect(snapshot).toMatchObject({
      oauthConfigured: true,
      status: 'down',
      lastSyncAt: '2026-09-18T13:15:00.000Z',
      errorCode: 'invalid_grant',
    })
    expect(snapshot.accounts[0]).toMatchObject({
      userEmail: 'ernest@savingkc.com',
      status: 'reauthorization_required',
      errorCode: 'invalid_grant',
    })
  })

  it('marks missing OAuth env as not_configured even when a token row exists', () => {
    const snapshot = mapGmailHealthSnapshot({
      oauthConfigured: false,
      accounts: [{
        userEmail: 'ernest@savingkc.com',
        hasRefreshToken: true,
        lastSyncAt: now,
        health: health('connected'),
      }],
    })

    expect(snapshot.status).toBe('not_configured')
    expect(snapshot.errorCode).toBe('google_oauth_not_configured')
    expect(snapshot.accounts[0]?.status).not.toBe('connected')
  })

  it('flags a connected grant whose last sync is older than 36 hours', () => {
    const snapshot = mapGmailHealthSnapshot({
      oauthConfigured: true,
      now: new Date(now),
      accounts: [{
        userEmail: 'ernest@savingkc.com',
        hasRefreshToken: true,
        lastSyncAt: '2026-09-18T12:00:00.000Z',
        health: health('connected'),
      }],
    })

    expect(snapshot.status).toBe('attention')
    expect(snapshot.errorCode).toBe('stale_sync')
    expect(snapshot.accounts[0]?.staleSync).toBe(true)
  })

  it('treats missing health as down rather than connected', () => {
    const snapshot = mapGmailHealthSnapshot({
      oauthConfigured: true,
      accounts: [{
        userEmail: 'ernest@savingkc.com',
        hasRefreshToken: true,
        lastSyncAt: now,
        health: null,
      }],
    })

    expect(snapshot.status).toBe('down')
    expect(snapshot.errorCode).toBe('connection_unverified')
  })

  it('flags a connected grant that is missing send or calendar after reconnect', () => {
    const snapshot = mapGmailHealthSnapshot({
      oauthConfigured: true,
      now: new Date(now),
      accounts: [{
        userEmail: 'ernest@savingkc.com',
        hasRefreshToken: true,
        lastSyncAt: now,
        scope: 'gmail.readonly',
        health: health('connected'),
      }],
    })

    expect(snapshot.status).toBe('attention')
    expect(snapshot.errorCode).toBe('missing_scopes')
    expect(snapshot.accounts[0]?.missingScopes).toEqual(expect.arrayContaining([
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/calendar',
    ]))
  })
})

describe('Gmail sync staleness helpers', () => {
  it('does not treat a missing last_sync_at as a stale live sync', () => {
    expect(isGmailSyncStale(null, new Date(now))).toBe(false)
    expect(hasNonEmptyRefreshToken('  ')).toBe(false)
    expect(hasNonEmptyRefreshToken('refresh-token')).toBe(true)
  })

  it('uses a 36 hour fail-closed window', () => {
    expect(isGmailSyncStale('2026-09-19T01:59:59.000Z', new Date(now))).toBe(true)
    expect(isGmailSyncStale('2026-09-19T02:00:01.000Z', new Date(now))).toBe(false)
  })
})
