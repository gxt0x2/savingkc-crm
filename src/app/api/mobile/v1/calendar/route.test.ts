import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireMobileUser: vi.fn(),
  listWorkItems: vi.fn(),
  listAppointments: vi.fn(),
  admin: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  inIds: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.requireMobileUser,
}))
vi.mock('@/lib/server/work-items', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/work-items')>(),
  listWorkItems: mocks.listWorkItems,
}))
vi.mock('@/lib/server/mobile-appointments', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/mobile-appointments')>(),
  listMobileAppointments: mocks.listAppointments,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { GET } from './route'

function request() {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/calendar', {
    headers: { Authorization: 'Bearer test' },
  })
}

describe('mobile Calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMobileUser.mockResolvedValue({ user: { email: 'ernest@savingkc.com' } })
    mocks.listWorkItems.mockResolvedValue([
      {
        key: 'activity:task-1', kind: 'appointment', title: 'Seller appointment', description: null,
        status: 'pending', priority: 'high', dueAt: '2026-09-18T15:00:00Z', assignedTo: 'Ernest',
        department: 'acquisitions', leadId: 'lead-1', sourceKind: 'activity', sourceId: 'task-1',
        role: 'in_person', version: 3, updatedAt: '2026-09-18T14:00:00Z',
      },
      {
        key: 'activity:task-2', kind: 'task', title: 'No-date task', description: null,
        status: 'pending', priority: 'normal', dueAt: null, assignedTo: 'Ernest',
        department: 'acquisitions', leadId: null, sourceKind: 'activity', sourceId: 'task-2',
        version: 1, updatedAt: '2026-09-18T14:00:00Z',
      },
    ])
    mocks.listAppointments.mockResolvedValue([{
      id: 'appointment-1', leadId: 'lead-1', type: 'in_person', status: 'scheduled',
      scheduledAt: '2026-09-19T15:00:00Z', endsAt: '2026-09-19T16:00:00Z',
      title: 'Seller visit', location: '123 Main St', timeZone: 'America/Chicago',
      assignedTo: 'Ernest', notes: 'Bring comps', sendReminder: true, version: 2,
      source: 'manual', createdAt: '2026-09-18T14:00:00Z', updatedAt: '2026-09-18T14:00:00Z',
      sync: { reminders: 'enabled', provider: 'not_configured', providerEventId: null, providerSyncedAt: null, providerError: null },
    }])
    mocks.inIds.mockResolvedValue({
      data: [{ id: 'lead-1', full_name: 'Morgan Seller', property_address: '123 Main St' }],
      error: null,
    })
    mocks.select.mockReturnValue({ in: mocks.inIds })
    mocks.from.mockReturnValue({ select: mocks.select })
    mocks.admin.mockReturnValue({ from: mocks.from })
  })

  it('returns current scheduled work with contact context', async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(mocks.listWorkItems).toHaveBeenCalledWith({ statuses: ['pending', 'blocked'], limit: 300 })
    await expect(response.json()).resolves.toMatchObject({
      items: [{
        id: 'appointment-1', type: 'in_person', contactId: 'lead-1',
        recordKind: 'appointment', appointmentId: 'appointment-1', appointmentVersion: 2,
        startsAt: '2026-09-19T15:00:00Z', endsAt: '2026-09-19T16:00:00Z',
      }, {
        id: 'activity:task-1', type: 'appointment', contactId: 'lead-1',
        contactName: 'Morgan Seller', propertyAddress: '123 Main St',
        recordKind: 'work_item', workItemKey: 'activity:task-1', workItemVersion: 3,
        sourceKind: 'activity', sourceId: 'task-1', role: 'in_person',
      }],
    })
  })

  it('fails closed before reading calendar data', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.requireMobileUser.mockRejectedValue(new MobileAuthError('Invalid bearer token'))

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.listWorkItems).not.toHaveBeenCalled()
    expect(mocks.listAppointments).not.toHaveBeenCalled()
  })
})
