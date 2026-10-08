import { describe, expect, it, vi } from 'vitest'
import { ingestGmailMessageStubs, leadThreadActivity, type LeadMatchRow } from '@/lib/gmail-sync'

const lead: LeadMatchRow = {
  id: 'lead-1',
  email: 'savingkc@gmail.com',
  full_name: 'Ernest Dodson',
  property_address: '1212 Main St',
}

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

function memoryDb() {
  const emails: Array<Record<string, unknown>> = []
  const activities: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  const db = {
    emails,
    activities,
    from(table: string) {
      const state = { messageId: '' }
      const api = {
        upsert: async (row: Record<string, unknown>) => {
          emails.push(row)
          return { error: null }
        },
        insert: async (row: Record<string, unknown>) => {
          const id = String((row.metadata as { gmail_message_id?: string }).gmail_message_id || '')
          activities.push(row)
          seen.add(`${table}:${id}`)
          return { error: null }
        },
        select() { return api },
        eq() { return api },
        contains(_column: string, value: { gmail_message_id?: string }) {
          state.messageId = value.gmail_message_id || ''
          return api
        },
        limit: async () => ({
          data: seen.has(`lead_activities:${state.messageId}`) ? [{ id: 'existing' }] : [],
          error: null,
        }),
      }
      return api
    },
  }
  return db
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
    expect(db.emails.map((row) => row.gmail_message_id).sort()).toEqual(['msg-news', 'msg-reply', 'msg-reply'])
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
      stubs: [{ id: 'msg-sent', threadId: 'thread-sent' }],
      fetchImpl: fetchImpl as never,
    })
    const second = await ingestGmailMessageStubs({
      db: db as never,
      accessToken: 'token',
      userEmail: 'ernest@savingkc.com',
      leads: [lead],
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
