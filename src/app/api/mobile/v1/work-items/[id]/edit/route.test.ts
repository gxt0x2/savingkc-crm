import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), access: vi.fn(), transition: vi.fn(), replay: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => {
  const query = { select: () => query, eq: () => query, maybeSingle: mocks.replay }
  return { from: () => query }
} }))
vi.mock('@/lib/mobile-api/mobile-command-access', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/mobile-command-access')>(), requireAuthorizedMobileWorkItem: mocks.actor }))
vi.mock('@/lib/server/work-items', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/work-items')>(), transitionWorkItem: mocks.transition,
}))

import { POST } from './route'
import { MobileCommandAccessError } from '@/lib/mobile-api/mobile-command-access'

const context = { params: Promise.resolve({ id: 'activity:event-1' }) }

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items/activity%3Aevent-1/edit', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer token',
      'Content-Type': 'application/json',
      'Idempotency-Key': 'edit-event-1',
    },
    body: JSON.stringify(body),
  })
}

describe('mobile work-item edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-18T12:00:00Z'))
    mocks.replay.mockResolvedValue({ data: null, error: null })
    mocks.actor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' } })
    mocks.transition.mockResolvedValue({
      changed: true,
      workItem: { key: 'activity:event-1', version: 4, title: 'Updated walk' },
    })
  })
  afterEach(() => vi.useRealTimers())
  it('rejects a changed past due date before the canonical transition', async () => {
    const response = await POST(request({ expectedVersion: 3, title: 'Walk', dueAt: '2000-01-01T10:00:00Z', assignedTo: 'Ernest' }), context)
    expect(response.status).toBe(400); expect(mocks.transition).not.toHaveBeenCalled()
  })
  it('allows an unrelated edit with the unchanged historical due date', async () => {
    mocks.actor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' }, dueAt: '2000-01-01T10:00:00.000Z' })
    const response = await POST(request({ expectedVersion: 3, title: 'Updated historical note', dueAt: '2000-01-01T10:00:00Z', assignedTo: 'Ernest' }), context)
    expect(response.status).toBe(200); expect(mocks.transition).toHaveBeenCalledOnce()
  })

  it('edits through the versioned canonical work-item service', async () => {
    const response = await POST(request({
      expectedVersion: 3,
      title: ' Updated walk ',
      notes: 'Bring the agreement',
      dueAt: '2026-09-21T15:00:00.000Z',
      assignedTo: 'Casey',
    }), context)

    expect(response.status).toBe(200)
    expect(mocks.transition).toHaveBeenCalledWith({
      key: 'activity:event-1',
      actor: 'Ernest',
      action: 'edit',
      idempotencyKey: 'edit-event-1',
      expectedVersion: 3,
      patch: {
        title: 'Updated walk',
        notes: 'Bring the agreement',
        dueAt: '2026-09-21T15:00:00.000Z',
        assignedTo: 'Casey',
      },
    })
  })

  it('rejects missing version and unauthorized assignment before mutation', async () => {
    const missingVersion = await POST(request({
      title: 'Walk', dueAt: '2026-09-21T15:00:00.000Z', assignedTo: 'Ernest',
    }), context)
    expect(missingVersion.status).toBe(400)

    const unauthorized = await POST(request({
      expectedVersion: 3, title: 'Walk', dueAt: '2026-09-21T15:00:00.000Z', assignedTo: 'Unknown',
    }), context)
    expect(unauthorized.status).toBe(403)
    expect(mocks.transition).not.toHaveBeenCalled()
  })
  it('does not edit an out-of-scope task', async () => {
    mocks.actor.mockRejectedValue(new MobileCommandAccessError('This work item is outside your authorized scope', 403))
    const response = await POST(request({ expectedVersion: 3, title: 'Walk', dueAt: null, assignedTo: 'Casey' }), context)
    expect(response.status).toBe(403)
    expect(mocks.transition).not.toHaveBeenCalled()
  })
})
