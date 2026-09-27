import { describe, expect, it, vi } from 'vitest'
import { GMAIL_MODIFY_SCOPE, REQUIRED_GOOGLE_OAUTH_SCOPES } from '@/lib/google-oauth-scopes'
import {
  ensureGmailWatch,
  gmailWatchNeedsRenewal,
  historyIdAfterIngest,
  historyIdAfterWatch,
  startGmailWatch,
  stopGmailWatch,
} from '@/lib/gmail-watch'

const topic = 'projects/savingkc-chat-bot/topics/gmail-push'
const subscription = 'projects/savingkc-chat-bot/subscriptions/gmail-push'
const readyEnv = {
  GOOGLE_PUBSUB_TOPIC: topic,
  GOOGLE_PUBSUB_SUBSCRIPTION: subscription,
  GOOGLE_PUBSUB_PUSH_SECRET: 'test-pubsub-push-secret',
}

describe('Gmail watch renewal', () => {
  it('renews a missing or soon-to-expire watch and keeps a fresh one', () => {
    const now = Date.parse('2026-09-27T00:00:00.000Z')
    expect(gmailWatchNeedsRenewal(null, now)).toBe(true)
    expect(gmailWatchNeedsRenewal('not-a-date', now)).toBe(true)
    expect(gmailWatchNeedsRenewal(new Date(now + 24 * 60 * 60 * 1000).toISOString(), now)).toBe(true)
    expect(gmailWatchNeedsRenewal(new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString(), now)).toBe(false)
  })

  it('keeps the stored history cursor across renew and only moves it forward after ingest', () => {
    expect(historyIdAfterWatch(null, '50')).toBe('50')
    expect(historyIdAfterWatch('40', '80')).toBe('40')
    expect(historyIdAfterIngest('40', '80')).toBe('80')
    expect(historyIdAfterIngest('90', '80')).toBe('90')
  })

  it('calls users.watch with the configured topic and users.stop on disconnect', async () => {
    const calls: Array<{ url: string; body?: string }> = []
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
      if (url.endsWith('/watch')) {
        return { ok: true, status: 200, json: async () => ({ historyId: '77', expiration: '1790000000000' }) }
      }
      return { ok: true, status: 204, json: async () => ({}) }
    }) as typeof fetch

    const started = await startGmailWatch({ accessToken: 'token', topicName: topic, fetchImpl })
    const stopped = await stopGmailWatch('token', fetchImpl)
    expect(started).toEqual({ ok: true, historyId: '77', expirationMs: 1790000000000 })
    expect(stopped).toEqual({ ok: true, code: 'watch_stopped' })
    expect(calls[0].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/watch')
    expect(JSON.parse(calls[0].body || '{}')).toEqual({
      topicName: topic,
      labelIds: ['INBOX'],
      labelFilterAction: 'include',
    })
    expect(calls[1].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/stop')
    expect(calls.some((call) => call.url.includes('/modify'))).toBe(false)
    expect(REQUIRED_GOOGLE_OAUTH_SCOPES).not.toContain(GMAIL_MODIFY_SCOPE)
  })

  it('does not call Google when Pub/Sub env is missing, the watch is current, or the mailbox is ineligible', async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch
    const save = vi.fn()
    const base = {
      userEmail: 'ernest@savingkc.com',
      crmEmail: 'ernest@savingkc.com',
      accessToken: 'token',
      scope: 'https://www.googleapis.com/auth/gmail.readonly',
      fetchImpl,
      save,
    }

    await expect(ensureGmailWatch({ ...base, env: {}, force: true })).resolves.toMatchObject({
      ok: false,
      code: 'pubsub_not_configured',
    })
    await expect(ensureGmailWatch({
      ...base,
      env: readyEnv,
      expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      force: false,
    })).resolves.toMatchObject({ ok: true, code: 'watch_current' })
    await expect(ensureGmailWatch({
      ...base,
      userEmail: 'seller.person@example.com',
      crmEmail: null,
      env: readyEnv,
      force: true,
    })).resolves.toMatchObject({ ok: false, code: 'mailbox_not_eligible' })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })

  it('starts a watch and stores the baseline history id on connect', async () => {
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ historyId: '77', expiration: '1790000000000' }),
    })) as unknown as typeof fetch
    const save = vi.fn().mockResolvedValue({ ok: true })
    const result = await ensureGmailWatch({
      userEmail: 'savingkc@gmail.com',
      accessToken: 'token',
      scope: 'gmail.readonly',
      force: true,
      env: readyEnv,
      fetchImpl,
      save,
    })
    expect(result).toMatchObject({ ok: true, code: 'watch_started', historyId: '77' })
    expect(save).toHaveBeenCalledWith({
      historyId: '77',
      expiration: new Date(1790000000000).toISOString(),
      topic,
    })
  })
})
