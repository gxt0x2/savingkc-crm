import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from, rpc: vi.fn() } }))

import { createDialerSessionControl } from './dialer-session-control.server'
import type { DialerSessionState } from './dialer-session-engine'

const sessionId = '00000000-0000-4000-8000-000000000010'
const actor = { email: 'casey@savingkc.com', name: 'Casey' }
const now = Date.now()

function session(): DialerSessionState {
  return {
    id: sessionId,
    status: 'active',
    actorEmail: actor.email,
    agentName: actor.name,
    queueKey: 'campaign:jackson_tax',
    savedQueueId: null,
    leadIds: ['00000000-0000-4000-8000-000000000001'],
    queueItems: [{
      kind: 'lead',
      id: '00000000-0000-4000-8000-000000000001',
      leadId: '00000000-0000-4000-8000-000000000001',
      prospectId: null,
      campaignMemberId: null,
    }],
    queueSize: 12,
    currentIndex: 3,
    currentLeadId: '00000000-0000-4000-8000-000000000001',
    currentProspectId: null,
    currentSubjectKind: 'lead',
    currentSubjectId: '00000000-0000-4000-8000-000000000001',
    currentCampaignMemberId: null,
    callerId: '+18163100845',
    settingsSnapshot: { campaignName: 'Jackson Tax' },
    dialsCompleted: 3,
    contacts: 1,
    skips: 0,
    outcomes: {},
    startedAt: new Date(now - 60_000).toISOString(),
    pausedAt: null,
    stopRequestedAt: null,
    endedAt: null,
    updatedAt: new Date(now).toISOString(),
    stateVersion: 1,
  }
}

function query(result: { data: unknown; error: unknown }, terminal: 'maybeSingle' | 'limit') {
  const builder: Record<string, unknown> = {}
  for (const method of ['select', 'eq', 'in', 'order']) builder[method] = vi.fn(() => builder)
  builder[terminal] = vi.fn().mockResolvedValue(result)
  return builder
}

describe('dialer session control summary', () => {
  beforeEach(() => vi.clearAllMocks())

  it('exposes only safe operation context while keeping explicit takeover available', async () => {
    const operationExpiresAt = new Date(now + 300_000).toISOString()
    mocks.from
      .mockReturnValueOnce(query({
        data: {
          controller_label: 'Chrome on Mac',
          controller_heartbeat_at: new Date(now).toISOString(),
          controller_lease_expires_at: new Date(now + 45_000).toISOString(),
          controller_generation: 4,
          controller_operation_id: '00000000-0000-4000-8000-000000000020',
          controller_operation_label: 'Saving contact note',
          controller_operation_expires_at: operationExpiresAt,
        },
        error: null,
      }, 'maybeSingle'))
      .mockReturnValueOnce(query({ data: [], error: null }, 'limit'))
    const control = createDialerSessionControl({
      DialerSessionError: class DialerSessionError extends Error {
        constructor(public code: string, public status: number, message: string) { super(message) }
      },
      getDialerSession: vi.fn().mockResolvedValue(session()),
      getOpenDialerSession: vi.fn().mockResolvedValue(session()),
      isUuid: (value: unknown): value is string => typeof value === 'string',
      mapDatabaseError: (error) => new Error(error?.message) as never,
      objectRecord: (value) => value as Record<string, unknown>,
      parseDialerSession: (value) => value as DialerSessionState,
    })

    const summary = await control.getDialerSessionControlSummary(actor, sessionId)

    expect(summary).toMatchObject({
      operationActive: true,
      operationLabel: 'Saving contact note',
      operationExpiresAt,
      canTakeOver: true,
    })
    expect(summary).not.toHaveProperty('operationId')
  })
})
