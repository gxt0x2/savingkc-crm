import { describe, expect, it, vi } from 'vitest'
import {
  googleAdsCallSidActivityOrFilter,
  isGoogleAdsMissedCallTaskDue,
  processGoogleAdsMissedCallTask,
  type GoogleAdsMissedCallTaskRow,
} from './google-ads-missed-call-reconciliation'

function task(overrides: Partial<GoogleAdsMissedCallTaskRow> = {}): GoogleAdsMissedCallTaskRow {
  return {
    id: 'task-1',
    lead_id: 'lead-1',
    created_at: '2026-05-26T14:00:00.000Z',
    metadata: {
      task_type: 'google_ads_missed_call_escalation',
      status: 'pending',
      due_date: '2026-05-26T14:05:00.000Z',
      missed_at: '2026-05-26T14:00:00.000Z',
      seller_phone: '+18165550123',
      called_number: '+18166088808',
      primary_agent_name: 'Casey',
      primary_agent_phone: '+18167564943',
      secondary_agent_name: 'Ernest',
      secondary_agent_phone: '+19137179716',
      callSid: 'CA123',
    },
    ...overrides,
  }
}

function deps(overrides: Partial<Parameters<typeof processGoogleAdsMissedCallTask>[1]['deps']> = {}) {
  return {
    getLeadStation: vi.fn().mockResolvedValue('new'),
    hasRespondedSince: vi.fn().mockResolvedValue(false),
    notifyTeam: vi.fn().mockResolvedValue(undefined),
    startCallback: vi.fn().mockResolvedValue({ started: true, sid: 'CA-callback' }),
    routingFor: vi.fn().mockReturnValue({
      primary: { name: 'Fallback', phone: '+18160000001' },
      secondary: { name: 'Backup', phone: '+18160000002' },
    }),
    updateTask: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

describe('Google Ads missed-call reconciliation', () => {
  it('uses one call SID filter for detected and repaired call activities', () => {
    expect(googleAdsCallSidActivityOrFilter('CA123')).toBe([
      'metadata->>callSid.eq.CA123',
      'metadata->>CallSid.eq.CA123',
      'metadata->>parent_call_sid.eq.CA123',
      'metadata->>parentCallSid.eq.CA123',
      'metadata->>call_sid.eq.CA123',
    ].join(','))
  })

  it('only treats pending due escalation tasks as due', () => {
    const now = new Date('2026-05-26T14:06:00.000Z')

    expect(isGoogleAdsMissedCallTaskDue(task(), now)).toBe(true)
    expect(isGoogleAdsMissedCallTaskDue(task({ metadata: { task_type: 'google_ads_missed_call_escalation', status: 'completed' } }), now)).toBe(false)
    expect(isGoogleAdsMissedCallTaskDue(task({ metadata: { task_type: 'other', status: 'pending' } }), now)).toBe(false)
    expect(isGoogleAdsMissedCallTaskDue(task({ metadata: { task_type: 'google_ads_missed_call_escalation', status: 'pending', due_date: '2026-05-26T14:07:00.000Z' } }), now)).toBe(false)
  })

  it('skips the escalation when the lead already responded', async () => {
    const mockedDeps = deps({ hasRespondedSince: vi.fn().mockResolvedValue(true) })

    const result = await processGoogleAdsMissedCallTask(task(), {
      now: new Date('2026-05-26T14:06:00.000Z'),
      dryRun: false,
      deps: mockedDeps,
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'skipped',
      reason: 'lead_responded_before_escalation',
    }))
    expect(mockedDeps.notifyTeam).not.toHaveBeenCalled()
    expect(mockedDeps.startCallback).not.toHaveBeenCalled()
    expect(mockedDeps.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      status: 'completed',
      skipped_reason: 'lead_responded_before_escalation',
    }))
  })

  it('skips the escalation for internal test phones', async () => {
    const mockedDeps = deps()

    const result = await processGoogleAdsMissedCallTask(task({
      metadata: {
        ...(task().metadata ?? {}),
        seller_phone: '+18165537559',
      },
    }), {
      now: new Date('2026-05-26T14:06:00.000Z'),
      dryRun: false,
      deps: mockedDeps,
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'skipped',
      reason: 'internal_test_phone',
    }))
    expect(mockedDeps.getLeadStation).not.toHaveBeenCalled()
    expect(mockedDeps.notifyTeam).not.toHaveBeenCalled()
    expect(mockedDeps.startCallback).not.toHaveBeenCalled()
    expect(mockedDeps.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      status: 'skipped',
      skipped_reason: 'internal_test_phone',
    }))
  })

  it('skips the escalation when the lead is already dead', async () => {
    const mockedDeps = deps({ getLeadStation: vi.fn().mockResolvedValue('dead') })

    const result = await processGoogleAdsMissedCallTask(task(), {
      now: new Date('2026-05-26T14:06:00.000Z'),
      dryRun: false,
      deps: mockedDeps,
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'skipped',
      reason: 'lead_station_dead',
    }))
    expect(mockedDeps.hasRespondedSince).not.toHaveBeenCalled()
    expect(mockedDeps.notifyTeam).not.toHaveBeenCalled()
    expect(mockedDeps.startCallback).not.toHaveBeenCalled()
    expect(mockedDeps.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      status: 'skipped',
      skipped_reason: 'lead_station_dead',
    }))
  })

  it('sends the reminder and starts the agent callback for due pending tasks', async () => {
    const mockedDeps = deps()

    const result = await processGoogleAdsMissedCallTask(task(), {
      now: new Date('2026-05-26T14:06:00.000Z'),
      dryRun: false,
      deps: mockedDeps,
    })

    expect(result).toEqual(expect.objectContaining({
      status: 'callback_started',
      callbackStarted: true,
      callbackSid: 'CA-callback',
    }))
    expect(mockedDeps.notifyTeam).toHaveBeenCalledWith(
      expect.stringContaining('REMINDER: Google Ads call from'),
      expect.objectContaining({ leadId: 'lead-1' }),
    )
    expect(mockedDeps.startCallback).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      leadPhone: '+18165550123',
      calledNumber: '+18166088808',
      agentName: 'Casey',
      agentPhone: '+18167564943',
      triggerCallSid: 'CA123',
    }))
    expect(mockedDeps.updateTask).toHaveBeenCalledWith('task-1', expect.objectContaining({
      status: 'completed',
      callback_started: true,
      callback_sid: 'CA-callback',
      processed_by: 'google_ads_missed_call_reconciliation',
    }))
  })
})
