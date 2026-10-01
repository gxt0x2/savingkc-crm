import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncUserMojoEmails } from './mojo-email-sync'

const mocks = vi.hoisted(() => ({ insert: vi.fn(), from: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }))
vi.mock('@/lib/gmail-sync', () => ({
  hasGoogleOAuthConfig: () => true,
  getValidAccessTokenResult: async () => ({ accessToken: 'test-token' }),
}))

// Representative provider template, with fictional contact details. Historical
// group membership must not turn a due-task reminder into a new appointment call.
const reminder = `Mojo Pending Events
Follow-Up Call
Date: 2026-10-01 11:00:00 AM
Title: Call Seller
Contact Info
Full Name: Seller Example
Phone: 9135550123
Groups: "Appointment Set" "Follow Up"
History
2026-09-23 11:22:43 AM Scheduled call on 10/01/2026.
2026-09-23 11:21:26 AM Added to group Appointment Set`

function serveMessages(messages: { id: string; subject: string; body: string; html?: boolean }[]) {
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL) => {
    const url = new URL(input)
    const id = url.pathname.split('/').at(-1)
    if (id === 'messages') {
      return Response.json({ messages: messages.map(({ id }) => ({ id, threadId: id })) })
    }
    const message = messages.find(message => message.id === id)
    if (!message) return new Response(null, { status: 404 })
    return Response.json({
      id: message.id,
      threadId: message.id,
      internalDate: String(Date.parse('2026-10-01T15:06:20Z')),
      payload: {
        mimeType: message.html ? 'text/html' : 'text/plain',
        headers: [
          { name: 'Subject', value: message.subject },
          { name: 'From', value: 'no-reply@mojosells.com' },
        ],
        body: { data: Buffer.from(message.body).toString('base64url') },
      },
    })
  }))
}

beforeEach(() => {
  mocks.insert.mockReset().mockResolvedValue({ error: null })
  mocks.from.mockReset().mockImplementation((table: string) => {
    if (table === 'mojo_call_queue') return { insert: mocks.insert }
    const tokenQuery = {
      select: () => tokenQuery,
      eq: () => tokenQuery,
      single: async () => ({ data: { user_email: 'agent@example.com' } }),
    }
    return tokenQuery
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('Mojo email intake', () => {
  it('skips two separately delivered calendar reminders without creating call queue rows', async () => {
    serveMessages(['delivery-one', 'delivery-two'].map(id => ({
      id, subject: 'Pending events from Mojo calendar', body: reminder,
    })))
    expect(await syncUserMojoEmails('agent@example.com')).toMatchObject({
      scanned: 2, queued: 0, skipped: 2, failed: 0,
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it.each([
    { subject: 'Fwd: Pending events from Mojo calendar', body: 'Phone: 9135550123\nGroups: Appointment Set' },
    { subject: 'Mojo notification', body: `<html><body><h1>Mojo Pending Events</h1><p>${reminder}</p></body></html>`, html: true },
  ])('recognizes reminder subjects or the decoded template heading', async message => {
    serveMessages([{ id: 'reminder', ...message }])
    expect(await syncUserMojoEmails('agent@example.com')).toMatchObject({ queued: 0, skipped: 1 })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it.each([
    ['Appointment Set', 'Appointment Set'],
    ['Follow Up', 'Callback Requested'],
  ])('preserves intake for ordinary %s notifications', async (subject, disposition) => {
    serveMessages([{
      id: 'ordinary-notice', subject,
      body: 'Full Name: Seller Example\nPhone: 9135550123\nNotes: Seller requested follow up.',
    }])
    expect(await syncUserMojoEmails('agent@example.com')).toMatchObject({ queued: 1, skipped: 0 })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      record_id: 'mojo-email-ordinary-notice', status: 'pending',
      payload: expect.objectContaining({ disposition, record_id: 'mojo-email-ordinary-notice' }),
    }))
  })
})
