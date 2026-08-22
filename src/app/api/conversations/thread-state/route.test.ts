import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  resolveAuthenticatedActor: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { POST } from './route'

let insertedActivities: unknown[]
const LEAD_ID = '00000000-0000-4000-8000-000000000001'

function makeRequest(body: Record<string, unknown>): Request {
  return new Request('https://crm.savingkc.com/api/conversations/thread-state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      threadKey: `lead:${LEAD_ID}`,
      leadId: LEAD_ID,
      phone: '+19135550123',
      agent: 'Spoofed Agent',
      source: 'spoofed_source',
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
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.from.mockImplementation((table: string) => tableChain(table))
  })

  it('logs mark read as the authenticated actor and ignores a spoofed agent', async () => {
    const response = await POST(makeRequest({ action: 'mark_read' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.action).toBe('mark_read')
    expect(insertedActivities).toHaveLength(1)
    expect(insertedActivities[0]).toMatchObject({
      lead_id: LEAD_ID,
      activity_type: 'status_change',
      agent: 'Casey',
      metadata: {
        hub_action: 'mark_read',
        source: 'conversation_hub',
        thread_key: `lead:${LEAD_ID}`,
        prospect_phone_id: 'prospect-phone-1',
      },
    })
    expect((insertedActivities[0] as { metadata: Record<string, unknown> }).metadata).not.toHaveProperty('phone')
  })

  it('persists an unmatched phone thread without placing its virtual id in lead_id', async () => {
    const response = await POST(makeRequest({
      action: 'mark_read',
      resolutionReason: 'wrong_number',
      threadKey: 'phone:(913) 555-0123',
      leadId: 'unmatched:+19135550123',
      phone: '913-555-0123',
    }))

    expect(response.status).toBe(200)
    expect(insertedActivities[0]).toMatchObject({
      lead_id: null,
      agent: 'Casey',
      description: expect.stringContaining('Wrong number'),
      metadata: {
        source: 'conversation_hub',
        hub_action: 'mark_read',
        thread_key: 'phone:+19135550123',
        phone: '+19135550123',
        resolution_reason: 'wrong_number',
        resolution_reason_label: 'Wrong number',
      },
    })
  })

  it('requires a reviewed reason before resolving an unmatched conversation', async () => {
    const response = await POST(makeRequest({
      action: 'mark_read',
      threadKey: 'phone:+19135550123',
      leadId: null,
      phone: '+19135550123',
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'A resolutionReason is required for unmatched conversations' })
    expect(insertedActivities).toHaveLength(0)
  })

  it('preserves the allowlisted dialer provenance without accepting arbitrary sources', async () => {
    const response = await POST(makeRequest({
      action: 'mark_unread',
      source: 'dialer_prospecting_hub',
    }))

    expect(response.status).toBe(200)
    expect(insertedActivities[0]).toMatchObject({
      metadata: { source: 'dialer_prospecting_hub', hub_action: 'mark_unread' },
    })
  })

  it('rejects mismatched phone thread identity before inserting', async () => {
    const response = await POST(makeRequest({
      action: 'mark_read',
      threadKey: 'phone:+19135550123',
      leadId: null,
      phone: '+19135550999',
    }))

    expect(response.status).toBe(400)
    expect(insertedActivities).toHaveLength(0)
  })

  it('denies unauthenticated mutations before touching conversation data', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)

    const response = await POST(makeRequest({ action: 'mark_read' }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Unauthorized' })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(insertedActivities).toHaveLength(0)
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

  it('logs tag add and normalizes the tag', async () => {
    const response = await POST(makeRequest({
      action: 'tag_added',
      tag: 'Appointment Made',
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.tag).toBe('appointment_made')
    expect(insertedActivities[0]).toMatchObject({
      description: expect.stringContaining('Appointment Made'),
      metadata: {
        hub_action: 'tag_added',
        hub_tag: 'appointment_made',
        hub_tag_label: 'Appointment Made',
      },
    })
  })

  it('requires a valid tag for tag actions', async () => {
    const response = await POST(makeRequest({ action: 'tag_removed', tag: ' ' }))
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.error).toContain('tag')
    expect(insertedActivities).toHaveLength(0)
  })
})
