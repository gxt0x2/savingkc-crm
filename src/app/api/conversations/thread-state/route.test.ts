import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { POST } from './route'

let insertedActivities: unknown[]

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('https://crm.savingkc.com/api/conversations/thread-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leadId: 'lead-1',
      phone: '+19135550123',
      agent: 'Casey',
      prospectPhoneId: 'prospect-phone-1',
      ...body,
    }),
  })
}

function tableChain(table: string) {
  return {
    insert: vi.fn(async (payload: unknown) => {
      if (table === 'lead_activities') insertedActivities.push(payload)
      return { error: null }
    }),
  }
}

describe('conversation thread state actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertedActivities = []
    mocks.from.mockImplementation((table: string) => tableChain(table))
  })

  it('logs mark read as a hub action', async () => {
    const response = await POST(makeRequest({ action: 'mark_read' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.action).toBe('mark_read')
    expect(insertedActivities).toHaveLength(1)
    expect(insertedActivities[0]).toMatchObject({
      lead_id: 'lead-1',
      activity_type: 'status_change',
      metadata: {
        hub_action: 'mark_read',
        source: 'dialer_prospecting_hub',
        phone: '+19135550123',
        prospect_phone_id: 'prospect-phone-1',
      },
    })
  })

  it('requires a valid due date when creating reminders', async () => {
    const response = await POST(makeRequest({ action: 'reminder_created', dueAt: 'not a date' }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toContain('dueAt')
    expect(insertedActivities).toHaveLength(0)
  })

  it('logs reminder due date and note', async () => {
    const response = await POST(makeRequest({
      action: 'reminder_created',
      dueAt: '2026-06-27T15:00:00.000Z',
      note: 'Call back after lunch',
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.dueAt).toBe('2026-06-27T15:00:00.000Z')
    expect(insertedActivities[0]).toMatchObject({
      metadata: {
        hub_action: 'reminder_created',
        reminder_due_at: '2026-06-27T15:00:00.000Z',
        reminder_note: 'Call back after lunch',
      },
    })
  })
})
