import { describe, expect, it } from 'vitest'

import {
  buildMyDay,
  normalizeMyDayMonth,
  resolveMyDayDateRange,
  type BuildMyDayInput,
  type MyDayActivity,
  type MyDayLead,
} from './my-day'
import { buildMojoAttentionItems } from './my-day-attention'

function lead(overrides: Partial<MyDayLead> = {}): MyDayLead {
  return {
    id: 'lead-1',
    full_name: 'Seller One',
    phone: '+18165550100',
    property_address: '1 Main St',
    city: 'Kansas City',
    source: 'google_ads',
    station: 'offer_made',
    priority: 'hot',
    assigned_agent: 'Casey',
    created_at: '2026-08-03T15:00:00.000Z',
    updated_at: '2026-08-05T15:00:00.000Z',
    ...overrides,
  }
}

function activity(overrides: Partial<MyDayActivity> = {}): MyDayActivity {
  return {
    id: 'activity-1',
    lead_id: 'lead-1',
    activity_type: 'status_change',
    description: 'Stage changed',
    agent: 'Casey',
    metadata: { new_station: 'qualified' },
    created_at: '2026-08-03T16:00:00.000Z',
    ...overrides,
  }
}

function input(overrides: Partial<BuildMyDayInput> = {}): BuildMyDayInput {
  return {
    month: '2026-08',
    range: { preset: 'custom', from: '2026-08-01', to: '2026-08-05', label: 'Aug 1 – 5, 2026' },
    now: new Date('2026-08-05T18:00:00.000Z'),
    stats: [
      { date: '2026-08-03', calls_made: 10, meaningful_conversations: 4, followups_completed: 3, followups_missed: 1, metadata: { daily_habits: { reviewVision: true, objectionsHandling: 80 } } },
      { date: '2026-08-04', calls_made: 20, meaningful_conversations: 5, followups_completed: 1, followups_missed: 0, metadata: { daily_habits: { reviewVision: true, objectionsHandling: 100 } } },
    ],
    performance: [
      { metric_date: '2026-08-01', dialing_seconds: 0, in_progress_seconds: 0, calls: 0, contacts: 0, leads: 0, appointments: 0, source_fetched_at: '2026-08-01T22:00:00.000Z' },
      { metric_date: '2026-08-02', dialing_seconds: 0, in_progress_seconds: 0, calls: 0, contacts: 0, leads: 0, appointments: 0, source_fetched_at: '2026-08-02T22:00:00.000Z' },
      { metric_date: '2026-08-03', dialing_seconds: 3600, in_progress_seconds: 0, calls: 10, contacts: 4, leads: 1, appointments: 0, source_fetched_at: '2026-08-03T22:00:00.000Z' },
      { metric_date: '2026-08-04', dialing_seconds: 7200, in_progress_seconds: 0, calls: 20, contacts: 5, leads: 0, appointments: 0, source_fetched_at: '2026-08-04T22:00:00.000Z' },
      { metric_date: '2026-08-05', dialing_seconds: 0, in_progress_seconds: 0, calls: 0, contacts: 0, leads: 0, appointments: 0, source_fetched_at: '2026-08-05T22:00:00.000Z' },
    ],
    leads: [lead()],
    activities: [
      activity(),
      activity({ id: 'appointment-stage', metadata: { new_station: 'appointment_set' }, created_at: '2026-08-04T16:00:00.000Z' }),
      activity({ id: 'offer', activity_type: 'offer', metadata: {}, created_at: '2026-08-05T16:00:00.000Z' }),
    ],
    tasks: [activity({
      id: 'task-1',
      activity_type: 'task',
      description: 'Call Seller One',
      metadata: { task_type: 'callback', assigned_to: 'Casey', due_date: '2026-08-05T20:00:00.000Z', priority: 'high', status: 'pending' },
      created_at: '2026-08-05T17:00:00.000Z',
    })],
    appointments: [{ id: 'appt-1', lead_id: 'lead-1', type: 'in_person', status: 'scheduled', scheduled_at: '2026-08-06T20:00:00.000Z', assigned_to: 'casey', address: '1 Main St', notes: null, created_at: '2026-08-05T17:00:00.000Z' }],
    attentionItems: [],
    attentionAvailable: true,
    goals: { dailyCalls: 5, weeklyOpportunities: 5, weeklyAppointments: 2 },
    availability: { mojoPerformance: true, agentStats: true, appointments: true, habits: true },
    ...overrides,
  }
}

describe('Casey My Day model', () => {
  it('builds the seven-stage funnel from recorded Casey stats and stage events', () => {
    const report = buildMyDay(input())
    expect(report.funnel.map((metric) => [metric.label, metric.value])).toEqual([
      ['Calls', 30],
      ['Contacts', 9],
      ['Leads', 1],
      ['Opportunities', 1],
      ['Appointments Set', 1],
      ['Offers Made', 1],
      ['Under Contract', 0],
    ])
    expect(report.funnel[1].conversion).toBe(30)
    expect(report.funnel[4].conversion).toBe(100)
  })

  it('uses the authoritative Mojo lead total even when no new CRM lead row was created', () => {
    const report = buildMyDay(input({ leads: [] }))

    expect(report.funnel.find((metric) => metric.key === 'leads')?.value).toBe(1)
    expect(report.week.rows.find((row) => row.key === 'leads')?.days).toEqual([1, 0, 0, null, null])
  })

  it('credits a Casey qualification event even when the opportunity owner is blank', () => {
    const report = buildMyDay(input({
      leads: [],
      activities: [activity({
        id: 'unassigned-qualification',
        lead_id: 'unassigned-lead',
        agent: 'Casey Davis',
        metadata: { to_stage: 'qualified', source: 'crm_lifecycle_command_v1' },
      })],
    }))

    expect(report.funnel.find((metric) => metric.key === 'opportunities')?.value).toBe(1)
  })

  it('keeps the weekly snapshot aligned Monday through Friday and calculates habits', () => {
    const report = buildMyDay(input())
    expect(report.week.dayLabels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    expect(report.week.rows.find((row) => row.key === 'calls')?.days).toEqual([10, 20, 0, null, null])
    expect(report.week.rows.find((row) => row.key === 'leads')?.days).toEqual([1, 0, 0, null, null])
    expect(report.habits.find((habit) => habit.key === 'vision')?.value).toBe(100)
    expect(report.habits.find((habit) => habit.key === 'objections')?.value).toBe(90)
    expect(report.habits.find((habit) => habit.key === 'followup')?.value).toBe(80)
  })

  it('defaults My Day to today while retaining the containing workweek breakdown', () => {
    const now = new Date('2026-08-05T18:00:00.000Z')
    const range = resolveMyDayDateRange({}, now)
    const report = buildMyDay(input({ now, range }))

    expect(range).toEqual({ preset: 'today', from: '2026-08-05', to: '2026-08-05', label: 'Today' })
    expect(report.funnel.find((metric) => metric.key === 'calls')?.value).toBe(0)
    expect(report.funnel.find((metric) => metric.key === 'contacts')?.value).toBe(0)
    expect(report.week.rows.find((row) => row.key === 'calls')?.days).toEqual([10, 20, 0, null, null])
  })

  it('adds Casey native and Heir Dialer dispositions without changing Mojo aggregates', () => {
    const heirCall = activity({
      id: 'heir-call',
      activity_type: 'call',
      agent: 'Casey',
      metadata: { source: 'heir_dialer', disposition: 'spoke_with_owner' },
      created_at: '2026-08-03T18:00:00.000Z',
    })
    const twilioDuplicate = activity({
      id: 'twilio-status',
      activity_type: 'call',
      agent: 'Casey',
      metadata: { source: 'twilio_status_callback', status: 'completed' },
      created_at: '2026-08-03T18:00:05.000Z',
    })
    const report = buildMyDay(input({ activities: [...input().activities, heirCall, twilioDuplicate] }))

    expect(report.funnel[0].value).toBe(31)
    expect(report.funnel[1].value).toBe(10)
    expect(report.week.rows.find((row) => row.key === 'calls')?.days).toEqual([11, 20, 0, null, null])
    expect(report.week.rows.find((row) => row.key === 'contacts')?.days).toEqual([5, 5, 0, null, null])
  })

  it('does not count canonical Mojo contact evidence on top of the provider snapshot', () => {
    const mojoCall = activity({
      id: 'mojo-call-event',
      activity_type: 'call',
      agent: 'Mojo Email Sync',
      metadata: {
        source: 'mojo_call_event',
        disposition: 'Motivated seller',
        outcome: 'meaningful_conversation',
      },
      created_at: '2026-08-04T18:00:00.000Z',
    })
    const report = buildMyDay(input({ activities: [...input().activities, mojoCall] }))

    expect(report.funnel[0].value).toBe(30)
    expect(report.funnel[1].value).toBe(9)
    expect(report.week.rows.find((row) => row.key === 'calls')?.days).toEqual([10, 20, 0, null, null])
  })

  it('uses server-owned dialer performance without double-counting its activity rows', () => {
    const heirCall = activity({
      id: 'heir-call',
      activity_type: 'call',
      agent: 'Casey',
      metadata: { source: 'heir_dialer', disposition: 'spoke_with_owner' },
      created_at: '2026-08-03T18:00:00.000Z',
    })
    const report = buildMyDay(input({
      activities: [...input().activities, heirCall],
      dialerPerformance: [
        { metric_date: '2026-08-03', dialing_seconds: 1_800, calls: 1, contacts: 1 },
      ],
      availability: { ...input().availability, dialerPerformance: true },
    }))

    expect(report.funnel[0].value).toBe(31)
    expect(report.funnel[1].value).toBe(10)
    expect(report.performance).toMatchObject({ source: 'combined', status: 'available', dialingSeconds: 12_600 })
  })

  it('withholds aggregate totals when even one required provider day is missing', () => {
    const report = buildMyDay(input({ performance: input().performance.filter((row) => row.metric_date !== '2026-08-02') }))
    expect(report.performance.status).toBe('partial')
    expect(report.funnel[0].value).toBeNull()
    expect(report.funnel[1].value).toBeNull()
  })

  it('turns Casey-assigned work into real commitments and call-list candidates', () => {
    const report = buildMyDay(input())
    expect(report.queue).toHaveLength(1)
    expect(report.queue[0]).toMatchObject({ leadName: 'Seller One', action: 'Call', priority: 'High', leadId: 'lead-1' })
    expect(report.commitments.map((item) => item.id)).toContain('appointment:appt-1')
    expect(report.commitments.map((item) => item.id)).toContain('task:task-1')
  })

  it('surfaces only Casey recorded calls that still need review', () => {
    const report = buildMyDay(input({
      activities: [
        ...input().activities,
        activity({
          id: 'review-me',
          activity_type: 'call',
          description: 'Completed seller call',
          metadata: { recordingSid: 'RE123', review_reason: 'No next step set', ai_score: 62 },
          created_at: '2026-08-05T17:30:00.000Z',
        }),
        activity({
          id: 'already-reviewed',
          activity_type: 'call',
          metadata: { recordingSid: 'RE456', recording_review: { outcome: 'seller' } },
          created_at: '2026-08-05T17:45:00.000Z',
        }),
        activity({ id: 'no-recording', activity_type: 'call', metadata: {}, created_at: '2026-08-05T17:50:00.000Z' }),
      ],
    }))

    expect(report.callReviews).toEqual([expect.objectContaining({
      id: 'review-me',
      leadName: 'Seller One',
      reason: 'No next step set',
      aiScore: 62,
      status: 'available',
      href: '/call-review?activity=review-me',
    })])
  })

  it('shows unavailable stats as not recorded instead of silently fabricating zeros', () => {
    const report = buildMyDay(input({
      performance: [],
      availability: { mojoPerformance: false, agentStats: true, appointments: true, habits: false },
    }))
    expect(report.funnel[0].value).toBeNull()
    expect(report.funnel[1].value).toBeNull()
    expect(report.funnel[2].value).toBeNull()
    expect(report.week.rows.find((row) => row.key === 'calls')?.days).toEqual([null, null, null, null, null])
  })

  it('surfaces a meaningful Mojo callback on a dead record for human review', () => {
    const items = buildMojoAttentionItems({
      events: [{
        record_id: 'mojo-activity-1583-17451357',
        lead_id: 'dead-lead',
        contact_name: 'Seller One',
        property_address: '1 Main St',
        call_at: '2026-08-05T15:13:00.000Z',
        disposition_raw: 'Callback Requested',
        outcome: 'callback_scheduled',
        follow_up_at: null,
      }],
      leads: [{ id: 'dead-lead', full_name: 'Seller One', property_address: '1 Main St', station: 'dead', classification: 'dead' }],
      terminalEvents: [{ lead_id: 'dead-lead', to_stage: 'dead', occurred_at: '2026-08-05T15:08:00.000Z' }],
      range: input().range,
    })

    expect(items).toEqual([expect.objectContaining({
      id: 'mojo:mojo-activity-1583-17451357',
      leadId: 'dead-lead',
      leadName: 'Seller One',
      kind: 'terminal_record_activity',
      href: '/leads/dead-lead',
      missingFollowUpAt: true,
    })])
  })

  it('does not mislabel provider activity that happened before a record was closed', () => {
    const items = buildMojoAttentionItems({
      events: [{
        record_id: 'activity-before-death',
        lead_id: 'dead-lead',
        contact_name: 'Seller One',
        property_address: '1 Main St',
        call_at: '2026-08-05T15:13:00.000Z',
        disposition_raw: 'Callback Requested',
        outcome: 'callback_scheduled',
        follow_up_at: null,
      }],
      leads: [{ id: 'dead-lead', full_name: 'Seller One', property_address: '1 Main St', station: 'dead', classification: 'dead' }],
      terminalEvents: [{ lead_id: 'dead-lead', to_stage: 'dead', occurred_at: '2026-08-05T16:00:00.000Z' }],
      range: input().range,
    })

    expect(items).toEqual([])
  })

  it('normalizes invalid month input to the current Central month', () => {
    expect(normalizeMyDayMonth('2026-03')).toBe('2026-03')
    expect(normalizeMyDayMonth('not-a-month', new Date('2026-08-12T18:00:00.000Z'))).toBe('2026-08')
  })

  it('resolves useful bounded presets and clamps custom ranges to 90 days', () => {
    const now = new Date('2026-08-24T23:00:00.000Z')
    expect(resolveMyDayDateRange({ preset: 'this_week' }, now)).toMatchObject({ from: '2026-08-24', to: '2026-08-24' })
    expect(resolveMyDayDateRange({ preset: 'last_week' }, now)).toMatchObject({ from: '2026-08-17', to: '2026-08-23' })
    expect(resolveMyDayDateRange({ preset: 'previous_month' }, now)).toMatchObject({ from: '2026-07-01', to: '2026-07-31' })
    expect(resolveMyDayDateRange({ preset: 'custom', from: '2026-01-01', to: '2026-08-24' }, now)).toMatchObject({
      from: '2026-05-27',
      to: '2026-08-24',
    })
    expect(resolveMyDayDateRange({ preset: 'custom', from: '2026-08-01', to: '2026-08-24' }, now).label)
      .toBe('Aug 1 – Aug 24, 2026')
  })
})
