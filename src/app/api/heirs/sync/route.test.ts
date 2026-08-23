import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  prospect: {
    id: 'prospect-1',
    owner_1: 'Original Owner',
    owner_1_first: 'Original',
    owner_1_last: 'Owner',
    situs_street: '123 Main St',
    situs_city: 'Kansas City',
    situs_state: 'MO',
    situs_zip: '64101',
    county: 'Jackson',
    is_deceased: true,
  },
  deleteError: null as { message: string } | null,
  insertError: null as { message: string } | null,
  prospectUpdateError: null as { message: string } | null,
  activityError: null as { message: string } | null,
  deletes: 0,
  phoneInserts: [] as unknown[],
  activities: [] as Array<Record<string, unknown>>,
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from(table: string) {
      if (table === 'prospects') {
        return {
          select() {
            return {
              eq() {
                return {
                  limit() {
                    return {
                      async single() {
                        return { data: mocks.prospect, error: null }
                      },
                    }
                  },
                }
              },
            }
          },
          update() {
            return {
              async eq() {
                return { error: mocks.prospectUpdateError }
              },
            }
          },
        }
      }

      if (table === 'prospect_phones') {
        return {
          delete() {
            return {
              eq() {
                return {
                  async neq() {
                    mocks.deletes += 1
                    return { error: mocks.deleteError }
                  },
                }
              },
            }
          },
          async insert(payload: unknown) {
            mocks.phoneInserts.push(payload)
            return { error: mocks.insertError }
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
  return new NextRequest('https://crm.savingkc.com/api/heirs/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function upstream(relatives: unknown[]) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    async json() { return { relatives } },
  }))
}

describe('heir sync trust and containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.deleteError = null
    mocks.insertError = null
    mocks.prospectUpdateError = null
    mocks.activityError = null
    mocks.deletes = 0
    mocks.phoneInserts.length = 0
    mocks.activities.length = 0
    process.env.SKIPTRACE_SERVICE_URL = 'https://skiptrace.example.com'
  })

  it('rejects anonymous sync before parsing or calling the provider', async () => {
    mocks.actor.mockResolvedValue(null)
    const provider = vi.fn()
    vi.stubGlobal('fetch', provider)
    const req = request({ lead_id: 'lead-1' })
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(provider).not.toHaveBeenCalled()
    expect(mocks.deletes).toBe(0)
  })

  it('preserves existing heirs when the provider returns no usable phones', async () => {
    upstream([])

    const response = await POST(request({ lead_id: 'lead-1' }))

    expect(response.status).toBe(422)
    expect(mocks.deletes).toBe(0)
    expect(mocks.phoneInserts).toHaveLength(0)
  })

  it('attributes successful sync evidence to the authenticated actor', async () => {
    upstream([{
      name: 'Jamie Heir',
      relationship: 'Child',
      phones: [{ number: '+18165550100', type: 'mobile', is_connected: true }],
    }])

    const response = await POST(request({ lead_id: 'lead-1' }))

    expect(response.status).toBe(200)
    expect(mocks.deletes).toBe(1)
    expect(mocks.phoneInserts).toHaveLength(1)
    expect(mocks.activities).toEqual([expect.objectContaining({
      lead_id: 'lead-1',
      agent: 'Casey',
      metadata: expect.objectContaining({ action: 'sync_heirs' }),
    })])
  })

  it('stops before insertion when stale-row removal fails', async () => {
    mocks.deleteError = { message: 'delete unavailable' }
    upstream([{
      name: 'Jamie Heir',
      phones: [{ number: '+18165550100' }],
    }])

    const response = await POST(request({ lead_id: 'lead-1' }))

    expect(response.status).toBe(500)
    expect(mocks.phoneInserts).toHaveLength(0)
    expect(mocks.activities).toHaveLength(0)
  })
})
