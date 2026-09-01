import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  phoneRow: {
    id: 'phone-1',
    prospect_id: 'prospect-1',
    phone: '+18165550100',
    contact_name: 'Jamie Heir',
    relationship: 'child',
    prospects: { lead_id: 'lead-1' },
  } as {
    id: string
    prospect_id: string
    phone: string
    contact_name: string | null
    relationship: string | null
    prospects: { lead_id: string | null } | null
  } | null,
  phoneError: null as { message: string } | null,
  updateError: null as { message: string; code?: string } | null,
  activityError: null as { message: string } | null,
  updates: [] as Array<Record<string, unknown>>,
  activities: [] as Array<Record<string, unknown>>,
  assertDialerControl: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/api/dialer-mutation-control', () => ({
  assertDialerMutationControl: mocks.assertDialerControl,
  dialerMutationControlErrorResponse: (error: unknown) => {
    const typed = error as { code?: string; status?: number; message?: string }
    return typed.code
      ? Response.json({ error: typed.message, code: typed.code }, { status: typed.status || 409 })
      : null
  },
}))
vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from(table: string) {
      if (table === 'prospect_phones') {
        return {
          select() {
            return {
              eq() {
                return {
                  async single() {
                    return { data: mocks.phoneRow, error: mocks.phoneError }
                  },
                }
              },
            }
          },
          update(payload: Record<string, unknown>) {
            mocks.updates.push(payload)
            return {
              async eq() {
                return { error: mocks.updateError }
              },
            }
          },
        }
      }

      return {
        async insert(payload: Record<string, unknown>) {
          mocks.activities.push(payload)
          return { error: mocks.activityError }
        },
      }
    },
  },
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/heirs/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('heir verification mutation trust', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updates.length = 0
    mocks.activities.length = 0
    mocks.phoneRow = {
      id: 'phone-1',
      prospect_id: 'prospect-1',
      phone: '+18165550100',
      contact_name: 'Jamie Heir',
      relationship: 'child',
      prospects: { lead_id: 'lead-1' },
    }
    mocks.phoneError = null
    mocks.updateError = null
    mocks.activityError = null
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.assertDialerControl.mockResolvedValue(null)
  })

  it('rejects anonymous requests before parsing or touching CRM data', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request({ prospect_phone_id: 'phone-1', verified: true })
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.activities).toHaveLength(0)
  })

  it('uses the linked lead and authenticated actor instead of spoofed values', async () => {
    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      verified: true,
      lead_id: 'lead-1',
      agent: 'Spoofed Agent',
    }))

    expect(response.status).toBe(200)
    expect(mocks.updates).toEqual([expect.objectContaining({
      is_verified_contact: true,
      verified_by: 'Casey',
    })])
    expect(mocks.activities).toEqual([expect.objectContaining({
      lead_id: 'lead-1',
      agent: 'Casey',
      metadata: expect.objectContaining({
        prospect_phone_id: 'phone-1',
        action: 'verify_contact',
      }),
    })])
  })

  it('rejects lost dialer authority before changing verification', async () => {
    mocks.assertDialerControl.mockRejectedValue(Object.assign(new Error('This session moved'), {
      code: 'session_control_lost',
      status: 409,
    }))

    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      verified: true,
      lead_id: 'lead-1',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ code: 'session_control_lost' })
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.activities).toHaveLength(0)
  })

  it('rejects a mismatched lead before updating the heir phone', async () => {
    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      verified: false,
      lead_id: 'another-lead',
    }))

    expect(response.status).toBe(409)
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.activities).toHaveLength(0)
  })

  it('refuses orphaned phone evidence instead of trusting a client lead', async () => {
    mocks.phoneRow = {
      id: 'phone-1',
      prospect_id: 'prospect-1',
      phone: '+18165550100',
      contact_name: 'Jamie Heir',
      relationship: 'child',
      prospects: { lead_id: null },
    }

    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      verified: true,
      lead_id: 'lead-1',
    }))

    expect(response.status).toBe(409)
    expect(mocks.updates).toHaveLength(0)
    expect(mocks.activities).toHaveLength(0)
  })

  it('reports a truthful warning when verification saves without timeline evidence', async () => {
    mocks.activityError = { message: 'timeline unavailable' }

    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      verified: true,
      lead_id: 'lead-1',
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      verified: true,
      warning: expect.stringContaining('activity timeline'),
    })
  })

  it('verifies an unpromoted source Prospect and writes phone-thread evidence', async () => {
    mocks.phoneRow = {
      id: 'phone-1',
      prospect_id: 'prospect-1',
      phone: '+18165550100',
      contact_name: 'Jamie Heir',
      relationship: 'child',
      prospects: { lead_id: null },
    }

    const response = await POST(request({
      prospect_phone_id: 'phone-1',
      prospect_id: 'prospect-1',
      verified: true,
    }))

    expect(response.status).toBe(200)
    expect(mocks.activities).toEqual([expect.objectContaining({
      lead_id: null,
      metadata: expect.objectContaining({
        prospect_id: 'prospect-1',
        thread_key: 'phone:+18165550100',
      }),
    })])
  })
})
