import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDurableDialerSession, loadDialerSavedQueuesWithOpenSession } from './dialer-session-client'

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
  updatedAt: '2026-08-20T12:00:00.000Z',
}

afterEach(() => vi.unstubAllGlobals())

describe('dialer session client', () => {
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
})
