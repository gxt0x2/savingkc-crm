import { describe, expect, it, vi } from 'vitest'
import {
  backfillStoredThreadActivity,
  counterpartyLeadIds,
  decodeGmailSnippet,
  ingestGmailMessageStubs,
  leadThreadActivity,
  loadGmailInternalAddresses,
  type LeadMatchRow,
} from '@/lib/gmail-sync'

const lead: LeadMatchRow = {
  id: 'lead-1',
  email: 'savingkc@gmail.com',
  full_name: 'Ernest Dodson',
  property_address: '1212 Main St',
}
const selfLead: LeadMatchRow = {
  id: 'self-lead',
  email: 'ernest@savingkc.com',
  full_name: 'Ernest Dodson',
  property_address: null,
}
const seller: LeadMatchRow = {
  id: 'seller-lead',
  email: 'seller@example.com',
  full_name: 'Pat Seller',
  property_address: '44 Oak Ave',
}
const crmUsers = ['ernest@savingkc.com', 'oauth-review@savingkc.com']

function messageResponse(headers: Record<string, string>, snippet: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({
      id: 'msg-1',
      threadId: 'thread-1',
      internalDate: '1760000000000',
      snippet,
      payload: { headers: Object.entries(headers).map(([name, value]) => ({ name, value })) },
    }),
  }
}

type Row = Record<string, unknown>

// Evaluates the filters the sync uses and enforces the two keys it relies on:
// lead_emails (lead_id, gmail_message_id) and the lead_activities primary key.
function memoryDb(seed: { emails?: Row[]; activities?: Row[] } = {}) {
  const tables: Record<string, Row[]> = {
    lead_emails: [...(seed.emails ?? [])],
    lead_activities: [...(seed.activities ?? [])],
  }
  const counts = { activityInserts: 0 }
  function from(table: string) {
    const filters: Array<(row: Row) => boolean> = []
    const api = {
      select() { return api },
      order() { return api },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value)
        return api
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]))
        return api
      },
      gte(column: string, value: string) {
        filters.push((row) => String(row[column] ?? '') >= value)
        return api
      },
      contains(column: string, value: Row) {
        filters.push((row) => Object.entries(value).every(([key, expected]) => (row[column] as Row | undefined)?.[key] === expected))
        return api
      },
      limit: async (count: number) => ({
        data: tables[table].filter((row) => filters.every((filter) => filter(row))).slice(0, count),
        error: null,
      }),
      upsert: async (row: Row) => {
        const rows = tables[table]
        if (!rows.some((existing) => existing.lead_id === row.lead_id && existing.gmail_message_id === row.gmail_message_id)) {
          rows.push(row)
        }
        return { error: null }
      },
      insert: async (row: Row) => {
        counts.activityInserts += 1
        const rows = tables[table]
        if (row.id && rows.some((existing) => existing.id === row.id)) {
          return { error: { code: '23505', message: 'duplicate key value violates unique constraint' } }
        }
        rows.push(row)
        return { error: null }
      },
    }
    return api
  }
  return { emails: tables.lead_emails, activities: tables.lead_activities, counts, from }
}

describe('lead reply projection', () => {
  it('keeps a lead reply and a Gmail send to that lead, and drops newsletters', () => {
    const reply = leadThreadActivity({
      leadId: 'lead-1',
      leadEmail: 'savingkc@gmail.com',
      mailbox: 'ernest@savingkc.com',
      fromAddr: 'savingkc@gmail.com',
      toAddrs: ['ernest@savingkc.com'],
      subject: 'Re: 1212 Main St',
      snippet: 'Noon works.',
      sentAt: '2026-10-08T14:00:00.000Z',
      gmailMessageId: 'reply-1',
      gmailThreadId: 'thread-1',
    })
    expect(reply).toMatchObject({
      lead_id: 'lead-1',
      activity_type: 'email_received',
      description: 'Noon works.',
      agent: null,
      created_at: '2026-10-08T14:00:00.000Z',
      metadata: {
        source: 'gmail_sync',
        direction: 'inbound',
        from: 'savingkc@gmail.com',
        gmail_message_id: 'reply-1',
      },
    })
    expect(leadThreadActivity({
      leadId: 'lead-1',
      leadEmail: 'savingkc@gmail.com',
      mailbox: 'ernest@savingkc.com',
      fromAddr: 'ernest@savingkc.com',
      toAddrs: ['savingkc@gmail.com'],
      subject: 'Hello Motto',
      snippet: 'This is only a test',
      sentAt: '2026-10-08T13:11:39.000Z',
      gmailMessageId: 'sent-gmail',
      gmailThreadId: 'thread-sent',
    })).toMatchObject({
      activity_type: 'email',
      description: 'This is only a test',
      agent: 'ernest@savingkc.com',
      created_at: '2026-10-08T13:11:39.000Z',
      metadata: {
        source: 'gmail_sync',
        direction: 'outbound',
        sent: true,
        gmail_message_id: 'sent-gmail',
      },
    })
    expect(leadThreadActivity({
      leadId: 'lead-1',
      leadEmail: 'savingkc@gmail.com',
      mailbox: 'ernest@savingkc.com',
      fromAddr: 'statements@doc.webull.com',
      toAddrs: ['savingkc@gmail.com'],
      subject: 'Statement',
      snippet: 'Your statement',
      sentAt: '2026-10-08T14:00:00.000Z',
      gmailMessageId: 'news-1',
      gmailThreadId: 'thread-2',
    })).toBeNull()
    // The recipient mailbox sees the same send. That copy is not a second activity.
    expect(leadThreadActivity({
      leadId: 'lead-1',
      leadEmail: 'savingkc@gmail.com',
      mailbox: 'savingkc@gmail.com',
      fromAddr: 'ernest@savingkc.com',
      toAddrs: ['savingkc@gmail.com'],
      subject: 'Hello Motto',
      snippet: 'This is only a test',
      sentAt: '2026-10-08T13:11:39.000Z',
      gmailMessageId: 'recipient-copy',
      gmailThreadId: 'thread-sent',
    })).toBeNull()
  })

  it('writes one Inbox activity for a lead reply and leaves a concurrent newsletter alone', async () => {
    const db = memoryDb()
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/msg-reply')) {
        return messageResponse({
          From: 'Saving KC <savingkc@gmail.com>',
          To: 'ernest@savingkc.com',
          Subject: 'Re: 1212 Main St',
        }, 'Noon works.')
      }
      return messageResponse({
        From: 'Webull <statements@doc.webull.com>',
        To: 'savingkc@gmail.com',
        Subject: 'Statement',
      }, 'Your statement is ready.')
    })
    const first = await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: 'ernest@savingkc.com',
      leads: [lead],
      internalAddresses: [],
      stubs: [
        { id: 'msg-reply', threadId: 'thread-1' },
        { id: 'msg-news', threadId: 'thread-2' },
      ],
      fetchImpl: fetchImpl as never,
    })
    const second = await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: 'ernest@savingkc.com',
      leads: [lead],
      internalAddresses: [],
      stubs: [{ id: 'msg-reply', threadId: 'thread-1' }],
      fetchImpl: fetchImpl as never,
    })
    expect(first).toMatchObject({ scanned: 2, matched: 2, inserted: 2 })
    expect(second.matched).toBe(1)
    expect(db.activities).toHaveLength(1)
    expect(db.activities[0]).toMatchObject({
      activity_type: 'email_received',
      description: 'Noon works.',
      metadata: { gmail_message_id: 'msg-reply', direction: 'inbound' },
    })
    expect(db.emails.map((row) => row.gmail_message_id).sort()).toEqual(['msg-news', 'msg-reply'])
  })

  it('writes one outbound activity when the mailbox sends to the lead from Gmail', async () => {
    const db = memoryDb()
    const fetchImpl = vi.fn(async () => messageResponse({
      From: 'Ernest Dodson <ernest@savingkc.com>',
      To: 'Michael Douglas <savingkc@gmail.com>',
      Subject: 'Hello Motto',
    }, 'This is only a test'))
    const first = await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: 'ernest@savingkc.com',
      leads: [lead],
      internalAddresses: [],
      stubs: [{ id: 'msg-sent', threadId: 'thread-sent' }],
      fetchImpl: fetchImpl as never,
    })
    const second = await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: 'ernest@savingkc.com',
      leads: [lead],
      internalAddresses: [],
      stubs: [{ id: 'msg-sent', threadId: 'thread-sent' }],
      fetchImpl: fetchImpl as never,
    })
    expect(first).toMatchObject({ scanned: 1, matched: 1, inserted: 1 })
    expect(second.matched).toBe(1)
    expect(db.activities).toHaveLength(1)
    expect(db.activities[0]).toMatchObject({
      activity_type: 'email',
      description: 'This is only a test',
      agent: 'ernest@savingkc.com',
      metadata: { direction: 'outbound', gmail_message_id: 'msg-sent', sent: true },
    })
  })
})

describe('lead selection for a mailbox', () => {
  it('files mail with the lead on the other side even when a self-test lead is listed first', async () => {
    const db = memoryDb()
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/hello-motto')) {
        return messageResponse({
          From: 'Ernest Dodson <ernest@savingkc.com>',
          To: 'savingkc@gmail.com',
          Subject: 'Hello Motto',
        }, 'This is only a test')
      }
      return messageResponse({
        From: 'Pat Seller <seller@example.com>',
        To: 'Ernest Dodson <ernest@savingkc.com>',
        Subject: 'Re: 44 Oak Ave',
      }, 'Call me after 5.')
    })
    await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: 'ernest@savingkc.com',
      leads: [selfLead, lead, seller],
      internalAddresses: crmUsers,
      stubs: [
        { id: 'hello-motto', threadId: 'thread-hm' },
        { id: 'seller-reply', threadId: 'thread-seller' },
      ],
      fetchImpl: fetchImpl as never,
    })
    expect(db.emails.map((row) => [row.gmail_message_id, row.lead_id])).toEqual([
      ['hello-motto', 'lead-1'],
      ['seller-reply', 'seller-lead'],
    ])
    expect(db.activities.map((row) => [row.lead_id, row.activity_type])).toEqual([
      ['lead-1', 'email'],
      ['seller-lead', 'email_received'],
    ])
  })

  it('does not project mail between two CRM users onto a self-test lead', async () => {
    const db = memoryDb()
    const fetchImpl = vi.fn(async () => messageResponse({
      From: 'Ernest Dodson <ernest@savingkc.com>',
      To: 'savingkc@gmail.com',
      Subject: 'Hello Motto',
    }, 'This is only a test'))
    const result = await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: 'savingkc@gmail.com',
      leads: [selfLead, lead],
      internalAddresses: crmUsers,
      stubs: [{ id: 'recipient-copy', threadId: 'thread-hm' }],
      fetchImpl: fetchImpl as never,
    })
    expect(result.matched).toBe(1)
    expect(db.activities).toEqual([])
  })

  it('keeps an app send with the lead it was addressed to when two leads share the address', async () => {
    const duplicate: LeadMatchRow = { ...seller, id: 'seller-duplicate' }
    const db = memoryDb({
      emails: [{ lead_id: 'seller-lead', gmail_message_id: 'app-send', synced_from_user: 'ernest@savingkc.com' }],
      activities: [{
        id: 'app-activity',
        lead_id: 'seller-lead',
        activity_type: 'email',
        metadata: { source: 'gmail_settings_send', gmail_message_id: 'app-send' },
      }],
    })
    const fetchImpl = vi.fn(async () => messageResponse({
      From: 'ernest@savingkc.com',
      To: 'seller@example.com',
      Subject: 'Offer',
    }, 'Here is the offer.'))
    await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: 'ernest@savingkc.com',
      leads: [duplicate, seller],
      internalAddresses: crmUsers,
      stubs: [{ id: 'app-send', threadId: 'thread-app' }],
      fetchImpl: fetchImpl as never,
    })
    expect(db.emails.map((row) => row.lead_id)).toEqual(['seller-lead'])
    expect(db.activities.map((row) => row.id)).toEqual(['app-activity'])
  })

  it('takes the sender for a reply and the recipients for a send, never a CRM user', () => {
    const leads = [selfLead, lead, seller, { ...seller, id: 'staff-lead', email: 'casey@savingkc.com' }]
    expect(counterpartyLeadIds({
      mailbox: 'ernest@savingkc.com',
      fromAddr: 'seller@example.com',
      toAddrs: ['ernest@savingkc.com'],
      ccAddrs: ['savingkc@gmail.com'],
      leads,
      internalAddresses: crmUsers,
    })).toEqual(['seller-lead'])
    expect(counterpartyLeadIds({
      mailbox: 'ernest@savingkc.com',
      fromAddr: 'ernest@savingkc.com',
      toAddrs: ['savingkc@gmail.com', 'casey@savingkc.com'],
      ccAddrs: ['seller@example.com'],
      leads,
      internalAddresses: crmUsers,
    })).toEqual(['lead-1', 'seller-lead'])
    expect(counterpartyLeadIds({
      mailbox: 'savingkc@gmail.com',
      fromAddr: 'ernest@savingkc.com',
      toAddrs: ['savingkc@gmail.com'],
      leads,
      internalAddresses: crmUsers,
    })).toEqual([])
  })

  it('treats the CRM login behind each Google grant as internal', async () => {
    const eq = vi.fn().mockResolvedValue({
      data: [
        { user_email: 'Ernest@SavingKC.com', crm_user_email: 'ernest@savingkc.com' },
        { user_email: 'savingkc@gmail.com', crm_user_email: 'oauth-review@savingkc.com' },
        { user_email: 'nedtyrell.428317@gmail.com', crm_user_email: null },
      ],
      error: null,
    })
    const db = { from: () => ({ select: () => ({ eq }) }) }
    await expect(loadGmailInternalAddresses(db as never)).resolves.toEqual([
      'ernest@savingkc.com',
      'oauth-review@savingkc.com',
      'nedtyrell.428317@gmail.com',
    ])
    eq.mockResolvedValueOnce({ data: null, error: { message: 'timeout' } })
    await expect(loadGmailInternalAddresses(db as never)).rejects.toThrow('gmail_internal_addresses_unavailable')
  })
})

describe('stored mail catch-up', () => {
  const since = '2026-10-01T13:15:00.000Z'
  const stored = (row: Row): Row => ({
    synced_from_user: 'ernest@savingkc.com',
    gmail_thread_id: 'thread',
    cc_addresses: [],
    ...row,
  })

  it('projects stored lead mail that left the Gmail list, including mail filed under a self-test lead', async () => {
    const db = memoryDb({
      emails: [
        stored({
          lead_id: 'lead-1',
          gmail_message_id: 'hello-motto',
          from_address: 'ernest@savingkc.com',
          to_addresses: ['savingkc@gmail.com'],
          subject: 'Hello Motto',
          body_snippet: 'This is only a test',
          sent_at: '2026-10-08T13:11:39+00:00',
        }),
        stored({
          lead_id: 'self-lead',
          gmail_message_id: 'swallowed-reply',
          from_address: 'seller@example.com',
          to_addresses: ['ernest@savingkc.com'],
          subject: 'Re: 44 Oak Ave',
          body_snippet: 'I&#39;m ready to talk.',
          sent_at: '2026-10-07T15:00:00+00:00',
        }),
        stored({
          lead_id: 'self-lead',
          gmail_message_id: 'newsletter',
          from_address: 'statements@doc.webull.com',
          to_addresses: ['ernest@savingkc.com'],
          subject: 'Statement',
          body_snippet: 'Your statement',
          sent_at: '2026-10-07T16:00:00+00:00',
        }),
        stored({
          lead_id: 'seller-lead',
          gmail_message_id: 'too-old',
          from_address: 'seller@example.com',
          to_addresses: ['ernest@savingkc.com'],
          subject: 'Old',
          body_snippet: 'Old',
          sent_at: '2026-09-20T15:00:00+00:00',
        }),
        stored({
          lead_id: 'seller-lead',
          gmail_message_id: 'listed-this-run',
          from_address: 'seller@example.com',
          to_addresses: ['ernest@savingkc.com'],
          subject: 'Listed',
          body_snippet: 'Listed',
          sent_at: '2026-10-08T15:00:00+00:00',
        }),
      ],
    })
    const run = () => backfillStoredThreadActivity({
      db: db as never,
      userEmail: 'ernest@savingkc.com',
      leads: [selfLead, lead, seller],
      internalAddresses: crmUsers,
      since,
      skipMessageIds: new Set(['listed-this-run']),
    })

    await expect(run()).resolves.toBe(2)
    await expect(run()).resolves.toBe(0)
    expect(db.activities.map((row) => [row.lead_id, row.activity_type, row.description])).toEqual([
      ['lead-1', 'email', 'This is only a test'],
      ['seller-lead', 'email_received', "I'm ready to talk."],
    ])
    expect(db.emails.filter((row) => row.gmail_message_id === 'swallowed-reply').map((row) => row.lead_id))
      .toEqual(['self-lead', 'seller-lead'])
  })
})

describe('Gmail snippet text', () => {
  it('decodes the entities Gmail escapes, once', () => {
    expect(decodeGmailSnippet('I&#39;m in &amp; ready &lt;3 &quot;today&quot; &#x2014;&nbsp;ok')).toBe('I\'m in & ready <3 "today" — ok')
    expect(decodeGmailSnippet('&amp;lt; stays text')).toBe('&lt; stays text')
    expect(decodeGmailSnippet('&bogus; &#0; &#xD800;')).toBe('&bogus; &#0; &#xD800;')
  })
})

describe('concurrent sync runs', () => {
  it('records one activity when two sync runs race on the same message', async () => {
    const db = memoryDb()
    const fetchImpl = vi.fn(async () => messageResponse({
      From: 'Pat Seller <seller@example.com>',
      To: 'ernest@savingkc.com',
      Subject: 'Re: 44 Oak Ave',
    }, 'Call me after 5.'))
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const ingest = () => ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: 'ernest@savingkc.com',
      leads: [seller],
      internalAddresses: crmUsers,
      stubs: [{ id: 'race', threadId: 'thread-race' }],
      fetchImpl: fetchImpl as never,
    })
    await Promise.all([ingest(), ingest()])
    expect(db.counts.activityInserts).toBe(2)
    expect(db.activities).toHaveLength(1)
    expect(errors).not.toHaveBeenCalled()
    errors.mockRestore()
  })
})
