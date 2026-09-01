import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createDurableDialerSession,
  DialerSessionClientError,
  isDialerControlLossError,
  loadDialerAttemptHistory,
  loadDialerSavedQueuesWithOpenSession,
  loadDialerSessionHistory,
} from './dialer-session-client'

const session = {
  id: '00000000-0000-4000-8000-000000000010',
  status: 'paused',
  actorEmail: 'casey@savingkc.com',
  agentName: 'Casey',
  queueKey: 'cold_prospecting',
  savedQueueId: '00000000-0000-4000-8000-000000000020',
  leadIds: ['00000000-0000-4000-8000-000000000001'],
  queueSize: 1,
  currentIndex: 0,
  currentLeadId: '00000000-0000-4000-8000-000000000001',
  callerId: '+18167277667',
  dialsCompleted: 2,
  contacts: 1,
  skips: 0,
  outcomes: {},
  startedAt: '2026-08-20T12:00:00.000Z',
  pausedAt: '2026-08-20T12:05:00.000Z',
  endedAt: null,
  updatedAt: '2026-08-20T12:00:00.000Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('dialer session client', () => {
  it('fails closed on a controller-loss code even when safe conflict details are unavailable', () => {
    expect(isDialerControlLossError(new DialerSessionClientError(
      'This dialing session moved to another window.',
      'session_control_lost',
    ))).toBe(true)
    expect(isDialerControlLossError(new Error('network failed'))).toBe(false)
  })

  it('treats a 409 existing session as resumable state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ created: false, session }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })))

    await expect(createDurableDialerSession({
      leadIds: session.leadIds,
      queueKey: 'custom',
      callerId: session.callerId,
      settings: {},
    })).resolves.toEqual({ created: false, session })
  })

  it('makes the durable server pointer authoritative in saved-session cards', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ savedLists: [{
        id: session.savedQueueId,
        name: 'Cold queue',
        sessionLeadIds: ['stale-lead'],
        resumeIndex: 99,
      }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ session }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const queues = await loadDialerSavedQueuesWithOpenSession()

    expect(queues[0]).toMatchObject({
      durableSessionId: session.id,
      sessionLeadIds: session.leadIds,
      resumeIndex: session.currentIndex,
      resumeLeadId: session.currentLeadId,
      sessionCompleted: false,
    })
  })

  it('uses opaque cursors for bounded session and attempt history', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [], pageInfo: { limit: 20, hasMore: false, nextCursor: null } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ session, attempts: { items: [], pageInfo: { limit: 50, hasMore: false, nextCursor: null } } }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    await loadDialerSessionHistory('session-cursor')
    await loadDialerAttemptHistory(session.id, 'attempt-cursor')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/dialer/sessions?scope=history&limit=20&cursor=session-cursor')
    expect(fetchMock.mock.calls[1][0]).toBe(`/api/dialer/sessions/${session.id}?include=attempts&limit=50&cursor=attempt-cursor`)
  })
})
