import { createSign, generateKeyPairSync } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/inbound-email-alert', () => ({ notifyInboundEmail: vi.fn(async () => undefined) }))

import { POST } from '@/app/api/webhooks/google/gmail/route'
import { ingestGmailMessageStubs } from '@/lib/gmail-sync'
import { handleGmailPubSubPush } from '@/lib/gmail-push'
import {
  authorizeGmailPubSubRequest,
  decodeGmailPushMessage,
  isStaffOrSandboxMailbox,
  verifyGooglePubSubOidcJwt,
} from '@/lib/gmail-pubsub'

const topic = 'projects/savingkc-chat-bot/topics/gmail-push'
const subscription = 'projects/savingkc-chat-bot/subscriptions/gmail-push'
const audience = 'https://crm.savingkc.com/api/webhooks/google/gmail'
const serviceAccount = 'gmail-push@savingkc-chat-bot.iam.gserviceaccount.com'
const pushSecret = 'test-pubsub-push-secret'

const oidcEnv = {
  GOOGLE_PUBSUB_TOPIC: topic,
  GOOGLE_PUBSUB_SUBSCRIPTION: subscription,
  GOOGLE_PUBSUB_PUSH_AUDIENCE: audience,
  GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT: serviceAccount,
}

const secretEnv = {
  GOOGLE_PUBSUB_TOPIC: topic,
  GOOGLE_PUBSUB_SUBSCRIPTION: subscription,
  GOOGLE_PUBSUB_PUSH_SECRET: pushSecret,
}

function pushBody(email: string, historyId = '200', messageId = 'pubsub-1') {
  return {
    message: {
      data: Buffer.from(JSON.stringify({ emailAddress: email, historyId }), 'utf8').toString('base64'),
      messageId,
    },
    subscription,
  }
}

function signJwt(payload: Record<string, unknown>, privateKey: ReturnType<typeof generateKeyPairSync>['privateKey'], kid: string) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signer = createSign('RSA-SHA256')
  signer.update(`${header}.${body}`)
  signer.end()
  return `${header}.${body}.${signer.sign(privateKey).toString('base64url')}`
}

describe('Gmail Pub/Sub webhook auth', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('fails closed when topic, subscription, or push auth env is missing', async () => {
    const result = await handleGmailPubSubPush({
      authorization: `Bearer ${pushSecret}`,
      queryToken: null,
      headerToken: null,
      body: pushBody('ernest@savingkc.com'),
      env: {},
    })
    expect(result.status).toBe(503)
    expect(result.body.error).toBe('pubsub_not_configured')
    expect(result.body.missing).toEqual(expect.arrayContaining([
      'GOOGLE_PUBSUB_TOPIC',
      'GOOGLE_PUBSUB_SUBSCRIPTION',
      'GOOGLE_PUBSUB_PUSH_SECRET',
    ]))
  })

  it('rejects a shared secret that does not match', async () => {
    const auth = await authorizeGmailPubSubRequest({
      authorization: 'Bearer not-the-secret',
      queryToken: null,
      headerToken: null,
      env: secretEnv,
    })
    expect(auth).toEqual({ ok: false, status: 401, reason: 'pubsub_auth_rejected' })
  })

  it('accepts the shared secret from the push URL token or bearer', async () => {
    const fromQuery = await authorizeGmailPubSubRequest({
      authorization: null,
      queryToken: pushSecret,
      headerToken: null,
      env: secretEnv,
    })
    const fromBearer = await authorizeGmailPubSubRequest({
      authorization: `Bearer ${pushSecret}`,
      queryToken: null,
      headerToken: null,
      env: secretEnv,
    })
    expect(fromQuery).toEqual({ ok: true, method: 'shared_secret' })
    expect(fromBearer).toEqual({ ok: true, method: 'shared_secret' })
  })

  it('verifies a Google OIDC push token and rejects the wrong audience or sender', async () => {
    const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey & { kid?: string }
    jwk.kid = 'test-key'
    const now = 1_700_000_000
    const jwt = signJwt({
      iss: 'https://accounts.google.com',
      aud: audience,
      exp: now + 300,
      iat: now,
      email: serviceAccount,
      email_verified: true,
    }, privateKey, 'test-key')
    const certs = async () => [jwk]

    await expect(verifyGooglePubSubOidcJwt(jwt, {
      audience,
      serviceAccount,
      nowSeconds: now,
    }, certs)).resolves.toBe(true)
    await expect(verifyGooglePubSubOidcJwt(jwt, {
      audience: 'https://evil.example/hook',
      serviceAccount,
      nowSeconds: now,
    }, certs)).resolves.toBe(false)
    await expect(verifyGooglePubSubOidcJwt(jwt, {
      audience,
      serviceAccount: 'other@example.iam.gserviceaccount.com',
      nowSeconds: now,
    }, certs)).resolves.toBe(false)

    const auth = await authorizeGmailPubSubRequest({
      authorization: `Bearer ${jwt}`,
      queryToken: null,
      headerToken: null,
      env: oidcEnv,
      nowSeconds: now,
      verifyOidc: (token, config) => verifyGooglePubSubOidcJwt(token, { ...config, nowSeconds: now }, certs),
    })
    expect(auth).toEqual({ ok: true, method: 'oidc' })
  })

  it('returns 401 from the route when push auth is configured and the request is not', async () => {
    vi.stubEnv('GOOGLE_PUBSUB_TOPIC', topic)
    vi.stubEnv('GOOGLE_PUBSUB_SUBSCRIPTION', subscription)
    vi.stubEnv('GOOGLE_PUBSUB_PUSH_SECRET', pushSecret)
    vi.stubEnv('GOOGLE_PUBSUB_PUSH_AUDIENCE', '')
    vi.stubEnv('GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT', '')
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/webhooks/google/gmail', {
      method: 'POST',
      headers: { authorization: 'Bearer nope', 'content-type': 'application/json' },
      body: JSON.stringify(pushBody('ernest@savingkc.com')),
    }))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'pubsub_auth_rejected' })
  })
})

describe('Gmail Pub/Sub idempotent ingest', () => {
  const staff = {
    id: 'tok-1',
    user_email: 'ernest@savingkc.com',
    access_token: 'access',
    refresh_token: 'refresh',
    expires_at: null,
    last_sync_at: null,
    crm_user_email: 'ernest@savingkc.com',
    gmail_history_id: '100',
  }

  it('ingests once when the same Pub/Sub message is delivered twice', async () => {
    const ingest = vi.fn().mockResolvedValue({ scanned: 1, matched: 1, inserted: 1 })
    const claim = vi.fn()
      .mockResolvedValueOnce('claimed')
      .mockResolvedValueOnce('duplicate')
    const complete = vi.fn().mockResolvedValue(undefined)
    const deps = {
      claim,
      complete,
      release: vi.fn(),
      loadMailbox: vi.fn().mockResolvedValue(staff),
      ingest,
    }
    const first = await handleGmailPubSubPush({
      authorization: `Bearer ${pushSecret}`,
      queryToken: null,
      headerToken: null,
      body: pushBody('ernest@savingkc.com', '200', 'same-message'),
      env: secretEnv,
      deps,
    })
    const second = await handleGmailPubSubPush({
      authorization: `Bearer ${pushSecret}`,
      queryToken: null,
      headerToken: null,
      body: pushBody('ernest@savingkc.com', '200', 'same-message'),
      env: secretEnv,
      deps,
    })
    expect(first.status).toBe(200)
    expect(first.body).toMatchObject({ ok: true, inserted: 1 })
    expect(second.body).toEqual({ ok: true, duplicate: true })
    expect(ingest).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('does not import a mailbox outside staff and sandbox, and omits that address from the response', async () => {
    const seller = 'seller.person@example.com'
    const ingest = vi.fn()
    const result = await handleGmailPubSubPush({
      authorization: `Bearer ${pushSecret}`,
      queryToken: null,
      headerToken: null,
      body: pushBody(seller),
      env: secretEnv,
      deps: {
        claim: vi.fn().mockResolvedValue('claimed'),
        complete: vi.fn().mockResolvedValue(undefined),
        release: vi.fn(),
        loadMailbox: vi.fn().mockResolvedValue({ ...staff, user_email: seller, crm_user_email: null }),
        ingest,
      },
    })
    expect(result.body).toEqual({ ok: true, skipped: 'ineligible_mailbox' })
    expect(JSON.stringify(result.body)).not.toContain(seller)
    expect(ingest).not.toHaveBeenCalled()
    expect(isStaffOrSandboxMailbox({ googleEmail: seller })).toBe(false)
    expect(isStaffOrSandboxMailbox({ googleEmail: 'savingkc@gmail.com' })).toBe(true)
    expect(isStaffOrSandboxMailbox({
      googleEmail: 'personal@gmail.com',
      crmEmail: 'ernest@savingkc.com',
    })).toBe(true)
  })

  it('upserts Gmail messages so a repeated message id does not insert another row', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const insert = vi.fn().mockResolvedValue({ error: null })
    const lookup = {
      select: () => lookup,
      in: () => lookup,
      eq: () => lookup,
      contains: () => lookup,
      limit: async () => ({ data: [], error: null }),
    }
    const fetched: string[] = []
    const result = await ingestGmailMessageStubs({
      db: { from: () => ({ ...lookup, upsert, insert }) } as never,
      accessToken: 'token',
      userEmail: 'ernest@savingkc.com',
      leads: [{ id: 'lead-1', email: 'seller@example.com', full_name: null, property_address: null }],
      internalAddresses: [],
      stubs: [
        { id: 'msg-1', threadId: 'thread-1' },
        { id: 'msg-1', threadId: 'thread-1' },
      ],
      fetchImpl: (async (url: string) => {
        fetched.push(url)
        return {
          ok: true,
          json: async () => ({
            id: 'msg-1',
            threadId: 'thread-1',
            internalDate: '1700000000000',
            snippet: 'private seller note',
            payload: { headers: [{ name: 'From', value: 'Seller <seller@example.com>' }, { name: 'Subject', value: 'Offer' }] },
          }),
        }
      }) as never,
    })
    expect(fetched).toHaveLength(1)
    expect(result).toEqual({ scanned: 1, matched: 1, inserted: 1 })
    expect(upsert).toHaveBeenCalledTimes(1)
    expect(upsert.mock.calls[0][1]).toEqual({ onConflict: 'lead_id,gmail_message_id', ignoreDuplicates: true })
    expect(upsert.mock.calls[0][0]).toMatchObject({ gmail_message_id: 'msg-1', lead_id: 'lead-1' })
    expect(insert).toHaveBeenCalledTimes(1)
    expect(insert.mock.calls[0][0]).toMatchObject({ lead_id: 'lead-1', activity_type: 'email_received' })
  })

  it('rejects a push body that is not a Gmail notification', () => {
    expect(decodeGmailPushMessage({ message: { data: 'not-json', messageId: '1' } })).toBeNull()
  })
})
