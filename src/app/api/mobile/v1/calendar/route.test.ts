import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), listWorkItems: vi.fn(), from: vi.fn(), appointments: vi.fn(), leads: vi.fn() }))
vi.mock('@/lib/mobile-api/mobile-command-access', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/mobile-command-access')>(), requireMobileCommandActor: mocks.actor,
}))
vi.mock('@/lib/server/work-items', async (original) => ({
  ...await original<typeof import('@/lib/server/work-items')>(), listWorkItems: mocks.listWorkItems,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }))
import { MobileAuthError } from '@/lib/mobile-api/auth'
import { GET } from './route'

const request = () => new NextRequest('https://crm.savingkc.com/api/mobile/v1/calendar', { headers: { Authorization: 'Bearer test' } })
const actor = { email: 'casey@savingkc.com', fullName: 'Casey', assignmentAliases: ['Casey'] }
const appointment = {
  id: 'appointment-1', lead_id: 'lead-1', type: 'in_person', status: 'scheduled',
  scheduled_at: '2026-10-01T15:00:00Z', ends_at: '2026-10-01T16:00:00Z', title: 'Seller visit',
  location: '123 Main St', address: '123 Main St', time_zone: 'America/Chicago',
  assigned_to: 'Casey', notes: null, sequence_enabled: false, version: 3, source: 'mobile',
  created_at: '2026-09-18T12:00:00Z', updated_at: '2026-09-18T12:00:00Z',
  provider_event_id: null, provider_sync_status: 'not_configured', provider_synced_at: null, provider_sync_error: null,
}

describe('mobile Calendar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ scopedActor: actor, actor: { email: actor.email, name: actor.fullName } })
    mocks.listWorkItems.mockResolvedValue([
      { key: 'activity:task-1', sourceKind: 'activity', sourceId: 'task-1', version: 2,
        kind: 'callback', title: 'Call seller', description: null, status: 'pending', priority: 'high',
        dueAt: '2026-10-01T15:00:00Z', assignedTo: 'Casey', role: 'setter', department: 'acquisitions',
        leadId: 'lead-1', updatedAt: '2026-09-18T12:00:00Z' },
      { key: 'activity:task-2', kind: 'task', dueAt: '2026-10-01T15:00:00Z', leadId: 'lead-2', assignedTo: 'Ernest' },
    ])
    mocks.appointments.mockResolvedValue({ data: [appointment, { ...appointment, id: 'appointment-2', lead_id: 'lead-2' }], error: null })
    mocks.leads.mockResolvedValue({ data: [
      { id: 'lead-1', full_name: 'Morgan Seller', property_address: '123 Main St', assigned_agent: 'Casey' },
      { id: 'lead-2', full_name: 'Other Seller', property_address: '999 Main St', assigned_agent: 'Ernest' },
    ], error: null })
    mocks.from.mockImplementation((table: string) => table === 'appointments'
      ? { select: () => ({ order: () => ({ limit: mocks.appointments }) }) }
      : { select: () => ({ in: mocks.leads }) })
  })

  it('returns canonical appointment versions and scoped editable work items', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 'activity:task-1', recordKind: 'work_item', workItemKey: 'activity:task-1', workItemVersion: 2,
        sourceKind: 'activity', sourceId: 'task-1', role: 'setter', contactId: 'lead-1' }],
      appointments: [{ id: 'appointment-1', version: 3, leadId: 'lead-1', sync: { provider: 'not_configured' } }],
    })
  })

  it('rejects invalid bearer before reading data', async () => {
    mocks.actor.mockRejectedValue(new MobileAuthError('Invalid bearer token'))
    expect((await GET(request())).status).toBe(401)
    expect(mocks.listWorkItems).not.toHaveBeenCalled()
  })
})
