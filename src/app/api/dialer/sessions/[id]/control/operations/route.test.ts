import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  assert: vi.fn(),
  begin: vi.fn(),
  end: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveAuthenticatedActor }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  assertDialerSessionControlOperation: mocks.assert,
  beginDialerSessionControlOperation: mocks.begin,
  endDialerSessionControlOperation: mocks.end,
}))

import { DELETE, PATCH, POST } from './route'

const sessionId = '00000000-0000-4000-8000-000000000010'
const operationId = '00000000-0000-4000-8000-000000000020'
const controllerToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const actor = { email: 'casey@savingkc.com', name: 'Casey' }
const context = { params: Promise.resolve({ id: sessionId }) }

function request(method: 'POST' | 'PATCH' | 'DELETE', body: unknown, controller = controllerToken) {
  return new Request(`https://crm.savingkc.com/api/dialer/sessions/${sessionId}/control/operations`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(controller ? { 'X-Dialer-Controller': controller } : {}) },
    body: JSON.stringify(body),
  })
}

describe('dialer control operation route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue(actor)
    mocks.assert.mockResolvedValue(undefined)
    mocks.begin.mockResolvedValue({ control: { operationActive: true } })
    mocks.end.mockResolvedValue({ control: { operationActive: false } })
  })

  it('begins a bounded operation under the authenticated controller', async () => {
    const response = await POST(request('POST', { operationId, label: 'Saving contact note' }), context)

    expect(response.status).toBe(200)
    expect(mocks.begin).toHaveBeenCalledWith({
      actor,
      sessionId,
      controllerToken,
      operationId,
      label: 'Saving contact note',
    })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it('ends only the matching operation under the same controller', async () => {
    const response = await DELETE(request('DELETE', { operationId }), context)

    expect(response.status).toBe(200)
    expect(mocks.end).toHaveBeenCalledWith({ actor, sessionId, controllerToken, operationId })
  })

  it('renews only the matching operation under the same controller', async () => {
    const response = await PATCH(request('PATCH', { operationId }), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true })
    expect(mocks.assert).toHaveBeenCalledWith({ actor, sessionId, controllerToken, operationId })
    expect(response.headers.get('cache-control')).toBe('private, no-store')
  })

  it.each([
    [null],
    [{ operationId: 'not-a-uuid', label: 'Saving' }],
    [{ operationId, label: '' }],
    [{ operationId, label: 'x'.repeat(121) }],
  ])('rejects malformed begin input %#', async (body) => {
    const response = await POST(request('POST', body), context)
    expect(response.status).toBe(400)
    expect(mocks.begin).not.toHaveBeenCalled()
  })

  it('requires authentication and a browser controller', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    expect((await POST(request('POST', { operationId, label: 'Saving' }), context)).status).toBe(401)
    mocks.resolveAuthenticatedActor.mockResolvedValue(actor)
    expect((await POST(request('POST', { operationId, label: 'Saving' }, ''), context)).status).toBe(400)
    expect(mocks.begin).not.toHaveBeenCalled()
  })
})
