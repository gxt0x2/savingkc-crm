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
  rpc: vi.fn(),
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
    rpc: mocks.rpc,
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
        }
      }
      throw new Error(`Unexpected table access: ${table}`)
    },
  },
}))

import { POST } from './route'

function request(body: Record<string, unknown>, signal?: AbortSignal) {
  return new NextRequest('https://crm.savingkc.com/api/heirs/sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
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
    mocks.assertDialerControl.mockResolvedValue(null)
    mocks.rpc.mockResolvedValue({ data: 1, error: null })
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
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('preserves existing heirs when the provider returns no usable phones', async () => {
    upstream([])

    const response = await POST(request({ lead_id: 'lead-1' }))

    expect(response.status).toBe(422)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('blocks a stale dialing window before calling the skip-trace provider', async () => {
    const provider = vi.fn()
    vi.stubGlobal('fetch', provider)
    mocks.assertDialerControl.mockRejectedValue(Object.assign(new Error('Use the controlling dialer window'), {
      code: 'dialer_session_control_required',
      status: 409,
    }))

    const response = await POST(request({ lead_id: 'lead-1' }))

    expect(response.status).toBe(409)
    expect(provider).not.toHaveBeenCalled()
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('attributes successful sync evidence to the authenticated actor', async () => {
    upstream([{
      name: 'Jamie Heir',
      relationship: 'Child',
      phones: [{ number: '+18165550100', type: 'mobile', is_connected: true }],
    }])

    const response = await POST(request({ lead_id: 'lead-1' }))

    expect(response.status).toBe(200)
    expect(mocks.rpc).toHaveBeenCalledWith('replace_heir_skip_trace_v1', {
      p_lead_id: 'lead-1',
      p_prospect_id: 'prospect-1',
      p_actor: 'Casey',
      p_rows: [expect.objectContaining({
        phone: '+18165550100',
        contact_name: 'Jamie Heir',
        relationship: 'child',
      })],
    })
  })

  it('reasserts a leased dialer operation after the provider responds and before saving', async () => {
    mocks.assertDialerControl.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    upstream([{
      name: 'Jamie Heir',
      relationship: 'Child',
      phones: [{ number: '+18165550100', type: 'mobile', is_connected: true }],
    }])

    const response = await POST(request({
      lead_id: 'lead-1',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }))

    expect(response.status).toBe(200)
    expect(mocks.assertDialerControl).toHaveBeenCalledTimes(2)
    expect(mocks.assertDialerControl).toHaveBeenLastCalledWith(expect.objectContaining({
      sessionId: '11111111-1111-4111-8111-111111111111',
      required: true,
    }))
    expect(fetch).toHaveBeenCalledWith('https://skiptrace.example.com/skip-trace', expect.objectContaining({
      signal: expect.any(AbortSignal),
    }))
    expect(vi.mocked(fetch).mock.invocationCallOrder[0]).toBeLessThan(mocks.assertDialerControl.mock.invocationCallOrder[1])
    expect(mocks.assertDialerControl.mock.invocationCallOrder[1]).toBeLessThan(mocks.rpc.mock.invocationCallOrder[0])
  })

  it('cancels a protected provider request and marks the operation outcome uncertain', async () => {
    mocks.assertDialerControl.mockResolvedValue({ id: '11111111-1111-4111-8111-111111111111' })
    const controller = new AbortController()
    const provider = vi.fn((_url: string, init?: RequestInit) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    }))
    vi.stubGlobal('fetch', provider)
    const posting = POST(request({
      lead_id: 'lead-1',
      dialerSessionId: '11111111-1111-4111-8111-111111111111',
    }, controller.signal))

    await vi.waitFor(() => expect(provider).toHaveBeenCalledOnce())
    controller.abort(new DOMException('Client disconnected', 'AbortError'))
    const response = await posting

    expect(response.status).toBe(499)
    expect(response.headers.get('x-dialer-operation-uncertain')).toBe('true')
    await expect(response.json()).resolves.toEqual({ error: 'Skip-trace request was cancelled' })
    expect(mocks.rpc).not.toHaveBeenCalled()
  })

  it('fails without claiming success when the atomic replacement rolls back', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'transaction rolled back' } })
    upstream([{
      name: 'Jamie Heir',
      phones: [{ number: '+18165550100' }],
    }])

    const response = await POST(request({ lead_id: 'lead-1' }))

    expect(response.status).toBe(500)
    expect(mocks.rpc).toHaveBeenCalledOnce()
  })
})
