import { describe, expect, it } from 'vitest'

import { buildMyDay, normalizeMyDayMonth, type BuildMyDayInput, type MyDayActivity, type MyDayLead } from './my-day'

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
    now: new Date('2026-08-05T18:00:00.000Z'),
    stats: [
      { date: '2026-08-03', calls_made: 10, meaningful_conversations: 4, followups_completed: 3, followups_missed: 1, metadata: { daily_habits: { reviewVision: true, objectionsHandling: 80 } } },
      { date: '2026-08-04', calls_made: 20, meaningful_conversations: 5, followups_completed: 1, followups_missed: 0, metadata: { daily_habits: { reviewVision: true, objectionsHandling: 100 } } },
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
    goals: { dailyCalls: 5, weeklyOpportunities: 5, weeklyAppointments: 2 },
    availability: { agentStats: true, appointments: true, habits: true },
    ...overrides,
  }
}

describe('Casey My Day model', () => {
  it('builds the six-stage funnel from recorded Casey stats and stage events', () => {
    const report = buildMyDay(input())
    expect(report.funnel.map((metric) => [metric.label, metric.value])).toEqual([
      ['Calls', 30],
      ['Meaningful Conversations', 9],
      ['Opportunities', 1],
      ['Appointments Set', 1],
      ['Offers Made', 1],
      ['Under Contract', 0],
    ])
    expect(report.funnel[1].conversion).toBe(30)
    expect(report.funnel[3].conversion).toBe(100)
  })

  it('keeps the weekly snapshot aligned Monday through Friday and calculates habits', () => {
    const report = buildMyDay(input())
    expect(report.week.dayLabels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri'])
    expect(report.week.rows.find((row) => row.key === 'calls')?.days).toEqual([10, 20, 0, 0, 0])
    expect(report.habits.find((habit) => habit.key === 'vision')?.value).toBe(100)
    expect(report.habits.find((habit) => habit.key === 'objections')?.value).toBe(90)
    expect(report.habits.find((habit) => habit.key === 'followup')?.value).toBe(80)
  })

  it('turns Casey-assigned work into real commitments and call-list candidates', () => {
    const report = buildMyDay(input())
    expect(report.queue).toHaveLength(1)
    expect(report.queue[0]).toMatchObject({ leadName: 'Seller One', action: 'Call', priority: 'High', leadId: 'lead-1' })
    expect(report.commitments.map((item) => item.id)).toContain('appointment:appt-1')
    expect(report.commitments.map((item) => item.id)).toContain('task:task-1')
  })

  it('shows unavailable stats as not recorded instead of silently fabricating zeros', () => {
    const report = buildMyDay(input({ stats: [], availability: { agentStats: false, appointments: true, habits: false } }))
    expect(report.funnel[0].value).toBeNull()
    expect(report.funnel[1].value).toBeNull()
    expect(report.week.rows.find((row) => row.key === 'calls')?.days).toEqual([null, null, null, null, null])
  })

  it('normalizes invalid month input to the current Central month', () => {
    expect(normalizeMyDayMonth('2026-03')).toBe('2026-03')
    expect(normalizeMyDayMonth('not-a-month', new Date('2026-08-12T18:00:00.000Z'))).toBe('2026-08')
  })
})
