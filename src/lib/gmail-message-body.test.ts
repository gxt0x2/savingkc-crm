import { describe, expect, it, vi } from 'vitest'

import { backfillMatchedGmailBodies } from '@/lib/gmail-body-backfill'
import { ingestGmailMessageStubs, type LeadMatchRow } from '@/lib/gmail-sync'
import {
  createGmailBodyQuota,
  dropQuotedReplyHistory,
  plainTextFromGmailPayload,
  stripHtmlToText,
} from '@/lib/gmail-message-body'

const seller: LeadMatchRow = { id: 'seller-lead', email: 'seller@example.com', full_name: 'Pat Seller', property_address: null }
const ernest = 'ernest@savingkc.com'

function encoded(text: string) {
  return Buffer.from(text, 'utf8').toString('base64url')
}

function fullMessage(payload: { mimeType?: string; body?: { data?: string }; parts?: unknown[] }, snippet = 'snippet') {
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: 'msg', threadId: 'thread', snippet, payload }),
    text: async () => '',
  }
}

function metadataMessage(headers: Record<string, string>, snippet: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'msg',
      threadId: 'thread',
      internalDate: '1760000000000',
      snippet,
      payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
    }),
    text: async () => '',
  }
}

type Row = Record<string, unknown>

function memoryDb(seed: Row[] = []) {
  const emails = [...seed]
  const activities: Row[] = []
  function from(table: string) {
    const rows = table === 'lead_emails' ? emails : activities
    const filters: Array<(row: Row) => boolean> = []
    let patch: Row | null = null
    const matched = () => rows.filter((row) => filters.every((filter) => filter(row)))
    const api = {
      select() { return api },
      order() { return api },
      eq(column: string, value: unknown) { filters.push((row) => row[column] === value); return api },
      in(column: string, values: unknown[]) { filters.push((row) => values.includes(row[column])); return api },
      gte(column: string, value: string) { filters.push((row) => String(row[column] ?? '') >= value); return api },
      is(column: string, value: unknown) { filters.push((row) => (row[column] ?? null) === value); return api },
      contains(column: string, value: Row) {
        filters.push((row) => Object.entries(value).every(([key, expected]) => (row[column] as Row | undefined)?.[key] === expected))
        return api
      },
      update(value: Row) { patch = value; return api },
      range(start: number, end: number) {
        return Promise.resolve({ data: matched().slice(start, end + 1), error: null })
      },
      limit: async (count: number) => ({ data: matched().slice(0, count), error: null }),
      then(onFulfilled: (value: { error: null }) => unknown, onRejected?: (reason: unknown) => unknown) {
        if (patch) {
          const next = patch
          patch = null
          for (const row of rows) if (filters.every((filter) => filter(row))) Object.assign(row, next)
        }
        return Promise.resolve({ error: null }).then(onFulfilled, onRejected)
      },
      upsert: async (row: Row) => {
        if (!rows.some((existing) => existing.lead_id === row.lead_id && existing.gmail_message_id === row.gmail_message_id)) rows.push({ ...row })
        return { error: null }
      },
      insert: async (row: Row) => { rows.push(row); return { error: null } },
    }
    return api
  }
  return { emails, from }
}

describe('Gmail plain-text body', () => {
  it('prefers text/plain, strips HTML, drops quoted history, and caps the text', () => {
    expect(plainTextFromGmailPayload({
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: encoded('Thursday works.\n\nOn Tue, Oct 7, 2026 at 3:14 PM Pat <seller@example.com> wrote:\n> old') } },
        { mimeType: 'text/html', body: { data: encoded('<p>html body</p>') } },
      ],
    })).toBe('Thursday works.')
    expect(stripHtmlToText('<style>p{}</style><p>Thursday&nbsp;works.</p><div class="gmail_quote">On Tue wrote:<br>old</div>')).toBe('Thursday works.')
    expect(dropQuotedReplyHistory('Sounds good.\n\nFrom: Pat <seller@example.com>\nSent: Tuesday\nSubject: Re: Oak')).toBe('Sounds good.')
    expect(dropQuotedReplyHistory(`${'a'.repeat(20_050)}`)).toHaveLength(20_000)
  })
})

describe('matched Gmail body sync', () => {
  it('stores the plain body for a counterparty reply and skips format=full for a newsletter', async () => {
    const db = memoryDb()
    const urls: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      urls.push(url)
      if (url.includes('format=full')) {
        return fullMessage({ mimeType: 'text/plain', body: { data: encoded('Thursday works.\n\nOn Tue, Oct 7, 2026 at 3:14 PM Pat <seller@example.com> wrote:\n> old') } })
      }
      if (url.includes('msg-reply')) {
        return metadataMessage({ From: 'Pat Seller <seller@example.com>', To: ernest, Subject: 'Re: Oak' }, 'Thursday works.')
      }
      return metadataMessage({ From: 'Webull <statements@doc.webull.com>', To: 'savingkc@gmail.com', Subject: 'Statement' }, 'Your statement')
    })
    await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: ernest,
      leads: [seller, { id: 'lead-1', email: 'savingkc@gmail.com', full_name: 'Ernest Dodson', property_address: '1212 Main St' }],
      internalAddresses: [ernest],
      stubs: [{ id: 'msg-reply', threadId: 'thread-1' }, { id: 'msg-news', threadId: 'thread-2' }],
      fetchImpl: fetchImpl as never,
    })
    expect(urls.filter((url) => url.includes('format=full')).map((url) => url.includes('msg-reply'))).toEqual([true])
    expect(db.emails.find((row) => row.gmail_message_id === 'msg-reply')).toMatchObject({
      lead_id: 'seller-lead',
      body_text: 'Thursday works.',
      body_snippet: 'Thursday works.',
    })
    expect(db.emails.find((row) => row.gmail_message_id === 'msg-news')?.body_text).toBeUndefined()

    urls.length = 0
    await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: ernest,
      leads: [seller],
      internalAddresses: [ernest],
      stubs: [{ id: 'msg-reply', threadId: 'thread-1' }],
      fetchImpl: fetchImpl as never,
    })
    expect(urls.some((url) => url.includes('format=full'))).toBe(false)
  })

  it('stops further full fetches when Gmail returns a quota error', async () => {
    const db = memoryDb()
    const full: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      const id = url.includes('msg-b') ? 'msg-b' : 'msg-a'
      if (url.includes('format=full')) {
        full.push(id)
        return { ok: false, status: 429, text: async () => 'userRateLimitExceeded', json: async () => ({}) }
      }
      return metadataMessage({ From: 'Pat Seller <seller@example.com>', To: ernest, Subject: 'Re: Oak' }, 'Thursday')
    })
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: ernest,
      leads: [seller],
      internalAddresses: [ernest],
      stubs: [{ id: 'msg-a', threadId: 'thread-a' }, { id: 'msg-b', threadId: 'thread-b' }],
      fetchImpl: fetchImpl as never,
    })
    expect(full).toEqual(['msg-a'])
    expect(db.emails.every((row) => row.body_text == null)).toBe(true)
    errors.mockRestore()
  })
})

describe('matched Gmail body backfill', () => {
  const since = '2026-10-03T00:00:00.000Z'
  const stored = (row: Row): Row => ({ synced_from_user: ernest, gmail_thread_id: 'thread', cc_addresses: [], to_addresses: [ernest], ...row })

  it('fills the last week of counterparty mail and leaves newsletters and filled rows alone', async () => {
    const db = memoryDb([
      stored({ lead_id: 'seller-lead', gmail_message_id: 'recent', from_address: 'seller@example.com', subject: 'Re: Oak', sent_at: '2026-10-08T15:00:00.000Z', body_text: null }),
      stored({ lead_id: 'seller-lead', gmail_message_id: 'newsletter', from_address: 'statements@doc.webull.com', subject: 'Statement', sent_at: '2026-10-08T16:00:00.000Z', body_text: null }),
      stored({ lead_id: 'seller-lead', gmail_message_id: 'old', from_address: 'seller@example.com', subject: 'Old', sent_at: '2026-09-01T15:00:00.000Z', body_text: null }),
      stored({ lead_id: 'seller-lead', gmail_message_id: 'filled', from_address: 'seller@example.com', subject: 'Done', sent_at: '2026-10-08T12:00:00.000Z', body_text: 'Already stored' }),
    ])
    const full: string[] = []
    const fetchImpl = vi.fn(async (url: string) => {
      full.push(url)
      return fullMessage({ mimeType: 'text/html', body: { data: encoded('<p>I can meet Thursday.</p><blockquote>old</blockquote>') } })
    })
    const storedCount = await backfillMatchedGmailBodies({
      db: db as never,
      accessToken: 'token',
      userEmail: ernest,
      leads: [seller],
      internalAddresses: [ernest],
      since,
      quota: createGmailBodyQuota(),
      fetchImpl: fetchImpl as never,
      gapMs: 0,
    })
    expect(storedCount).toBe(1)
    expect(full).toHaveLength(1)
    expect(full[0]).toContain('recent')
    expect(full[0]).toContain('format=full')
    expect(db.emails.find((row) => row.gmail_message_id === 'recent')?.body_text).toBe('I can meet Thursday.')
    expect(db.emails.find((row) => row.gmail_message_id === 'newsletter')?.body_text).toBeNull()
    expect(db.emails.find((row) => row.gmail_message_id === 'filled')?.body_text).toBe('Already stored')
  })
})
