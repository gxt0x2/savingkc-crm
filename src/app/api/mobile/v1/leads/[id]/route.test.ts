import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireMobileUser: vi.fn(), authorizeLead: vi.fn(), admin: vi.fn(), listWorkItems: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.requireMobileUser,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/mobile-api/authorized-lead', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/authorized-lead')>(),
  requireAuthorizedMobileLead: mocks.authorizeLead,
}))
vi.mock('@/lib/server/work-items', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/work-items')>(), listWorkItems: mocks.listWorkItems,
}))

import { GET } from './route'

const context = { params: Promise.resolve({ id: 'lead-1' }) }

function database(activities: Array<Record<string, unknown>> = [], lead: Record<string, unknown> = {
  id: 'lead-1', station: 'under_contract', assigned_agent: 'Casey',
}) {
  return {
    from(table: string) {
      if (table === 'leads') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: lead, error: null,
        }) }) }) }
      }
      if (table.startsWith('em_')) {
        return { select: () => ({ in: async () => ({ data: [], error: null }) }) }
      }
      if (table === 'lead_activities') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: activities, error: null }) }) }) }) }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ order: () => ({ limit: async () => ({ data: [{ id: 'handoff-1' }], error: null }) }) }),
          }),
        }),
      }
    },
  }
}

describe('mobile lead operations detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMobileUser.mockResolvedValue({ user: { email: 'casey@savingkc.com' } })
    mocks.authorizeLead.mockResolvedValue({ actor: { email: 'casey@savingkc.com' }, lead: { id: 'lead-1' } })
    mocks.admin.mockReturnValue(database())
    mocks.listWorkItems.mockResolvedValue([{ key: 'activity:task-1', primaryNextAction: true }])
  })

  it('returns canonical owner, department, next action, and pending handoff state', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1', {
      headers: { Authorization: 'Bearer token' },
    }), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      operations: {
        department: 'dispositions',
        owner: 'Casey',
        primaryNextAction: { key: 'activity:task-1' },
        tasksAvailable: true,
        pendingHandoffs: [{ id: 'handoff-1' }],
        handoffsAvailable: true,
      },
    })
  })

  it('marks task state unavailable instead of presenting a misleading empty queue', async () => {
    mocks.listWorkItems.mockRejectedValue(new Error('not installed'))
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1', {
      headers: { Authorization: 'Bearer token' },
    }), context)

    await expect(response.json()).resolves.toMatchObject({
      operations: { primaryNextAction: null, tasksAvailable: false },
    })
  })

  it('returns property fact inputs only after actor authorization', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1', {
      headers: { Authorization: 'Bearer token' },
    }), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ propertyFacts: { lead: {}, property: null } })
    expect(mocks.authorizeLead).toHaveBeenCalledOnce()
  })

  it('reports an explicit email clear only after suppression and person rules are empty', async () => {
    mocks.admin.mockReturnValue(database([], {
      id: 'lead-1', station: 'qualified', assigned_agent: 'Ernest', email: 'savingkc@gmail.com',
    }))
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1', {
      headers: { Authorization: 'Bearer token' },
    }), context)
    await expect(response.json()).resolves.toMatchObject({
      lead: { email_opt_out: false, email_suppressed: false, email_consent: 'clear' },
    })
  })

  it('omits a false clear when the consent tables cannot be read', async () => {
    const base = database([], {
      id: 'lead-1', station: 'qualified', assigned_agent: 'Ernest', email: 'savingkc@gmail.com',
    })
    mocks.admin.mockReturnValue({
      from(table: string) {
        if (table.startsWith('em_')) throw new Error('consent unavailable')
        return base.from(table)
      },
    })
    const payload = await (await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1', {
      headers: { Authorization: 'Bearer token' },
    }), context)).json()
    expect(payload.lead.email_consent).toBe('unknown')
    expect(payload.lead.email_opt_out).toBeUndefined()
    expect(payload.lead.email_suppressed).toBeUndefined()
  })

  it('maps copied Mojo evidence to a scoped CRM playback URL and strips raw provider URLs', async () => {
    const activityId = '11111111-1111-4111-8111-111111111111'
    const eventId = '22222222-2222-4222-8222-222222222222'
    mocks.admin.mockReturnValue(database([{ id: activityId, activity_type: 'call', created_at: '2026-10-01T12:00:00Z',
      metadata: { provider: 'mojo', event_id: eventId, recording_storage_path: `events/${eventId}.mp3`,
        recordingUrl: 'https://app71.mojosells.com/protected.mp3' } }]))
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1', {
      headers: { Authorization: 'Bearer token' },
    }), context)
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload.activities[0].metadata.recordingUrl).toBe(`/api/mobile/v1/calls/${activityId}/recording`)
    expect(JSON.stringify(payload.activities)).not.toContain('app71.mojosells.com')
  })
})
