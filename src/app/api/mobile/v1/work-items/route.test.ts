import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), access: vi.fn(), create: vi.fn(), replay: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => {
  const query = { select: () => query, eq: () => query, maybeSingle: mocks.replay }
  return { from: () => query }
} }))
vi.mock('@/lib/mobile-api/mobile-command-access', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/mobile-command-access')>(), requireMobileCommandActor: mocks.actor }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(), requireAuthorizedMobileLead: mocks.access }))
vi.mock('@/lib/server/work-items', async (original) => ({ ...await original<typeof import('@/lib/server/work-items')>(), createWorkItem: mocks.create }))
import { WorkItemError } from '@/lib/server/work-items'
import { MobileLeadAccessError } from '@/lib/mobile-api/authorized-lead'
import { POST } from './route'

describe('mobile work-item create', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-09-18T12:00:00Z'))
    mocks.replay.mockResolvedValue({ data: null, error: null })
    mocks.actor.mockResolvedValue({ actor: { email: 'casey@savingkc.com', name: 'Casey' } })
    mocks.create.mockResolvedValue({ created: true, workItem: { key: 'activity:task-1', version: 1 } })
  })
  afterEach(() => vi.useRealTimers())
  it('rejects the independently reproduced new past task before persistence', async () => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'past-task-fixture' },
      body: JSON.stringify({ title: 'Past task fixture', taskType: 'task', dueDate: '2000-01-01T10:00:00.000Z', assignedTo: 'Ernest' }),
    }))
    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toEqual({ error: 'Choose a future task due time within two years.' })
  })
  it.each(['2030-01-01T10:00:00Z', '2026-02-30T10:00:00Z', 'invalid'])('rejects unsupported new due date %s', async (dueDate) => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'bad-date-fixture' },
      body: JSON.stringify({ title: 'Task fixture', taskType: 'task', dueDate, assignedTo: 'Ernest' }),
    }))
    expect(response.status).toBe(400); expect(mocks.create).not.toHaveBeenCalled()
  })
  it('creates through the canonical idempotent service', async () => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items', {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'task-create-1' },
      body: JSON.stringify({ title: 'Call seller', leadId: 'lead-1', taskType: 'callback', dueDate: '2026-09-19T15:00:00Z', assignedTo: 'Casey', department: 'acquisitions' }),
    }))
    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ actor: 'Casey', idempotencyKey: 'task-create-1', kind: 'callback', assignedTo: 'Casey' }))
  })
  it('rejects unsupported assignees before mutation', async () => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items', {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'task-create-1' },
      body: JSON.stringify({ title: 'Call seller', taskType: 'callback', assignedTo: 'Unknown' }),
    }))
    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
  it('accepts appointment records with their format role', async () => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items', {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'appointment-create-1' },
      body: JSON.stringify({ title: 'Seller walk', leadId: 'lead-1', taskType: 'appointment', role: 'in_person', dueDate: '2026-09-19T15:00:00Z', assignedTo: 'Ernest' }),
    }))
    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'appointment', role: 'in_person', idempotencyKey: 'appointment-create-1',
    }))
  })
  it('returns conflict when a retry key belongs to different task content', async () => {
    mocks.create.mockRejectedValue(new WorkItemError('That Idempotency-Key belongs to a different work item.', 'conflict'))
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items', {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'task-create-1' },
      body: JSON.stringify({ title: 'Different task', leadId: 'lead-1', taskType: 'callback', assignedTo: 'Casey' }),
    }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({ error: 'That Idempotency-Key belongs to a different work item.' })
  })
  it('does not create a task against an out-of-scope contact', async () => {
    mocks.access.mockRejectedValue(new MobileLeadAccessError('This contact is outside your authorized scope', 403))
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/work-items', {
      method: 'POST', headers: { Authorization: 'Bearer x', 'Content-Type': 'application/json', 'Idempotency-Key': 'task-create-1' },
      body: JSON.stringify({ title: 'Call seller', leadId: 'lead-1', taskType: 'callback', assignedTo: 'Casey' }),
    }))
    expect(response.status).toBe(403)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
