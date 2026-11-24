import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'

import { isOverdueScheduledAppointment, listOverdueScheduledAppointments } from './overdue-appointment-outcomes'

const now = new Date('2026-09-24T15:00:00.000Z')

describe('overdue appointment outcomes', () => {
  it('flags only scheduled appointments more than 24 hours past', () => {
    expect(isOverdueScheduledAppointment({ status: 'scheduled', scheduledAt: '2026-09-23T14:59:00.000Z' }, now.getTime())).toBe(true)
    expect(isOverdueScheduledAppointment({ status: 'scheduled', scheduledAt: '2026-09-23T16:00:00.000Z' }, now.getTime())).toBe(false)
    expect(isOverdueScheduledAppointment({ status: 'confirmed', scheduledAt: '2026-09-01T15:00:00.000Z' }, now.getTime())).toBe(false)
    expect(isOverdueScheduledAppointment({ status: 'rescheduled', scheduledAt: '2026-09-01T15:00:00.000Z' }, now.getTime())).toBe(false)
    expect(isOverdueScheduledAppointment({ status: 'completed', scheduledAt: '2026-09-01T15:00:00.000Z' }, now.getTime())).toBe(false)
  })

  it('reads the overdue rows and does not write', async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      lt: vi.fn(),
      order: vi.fn(),
      limit: vi.fn(async () => ({
        data: [
          { id: 'appt-old', lead_id: 'lead-1', scheduled_at: '2026-09-22T15:00:00.000Z', type: 'phone_call', status: 'scheduled', assigned_to: 'Casey', title: 'Seller call' },
          { id: 'appt-fresh', lead_id: 'lead-2', scheduled_at: '2026-09-24T12:00:00.000Z', type: 'phone_call', status: 'scheduled', assigned_to: 'Casey', title: 'Too recent' },
        ],
        error: null,
      })),
      update: vi.fn(),
      insert: vi.fn(),
    }
    query.select.mockReturnValue(query)
    query.eq.mockReturnValue(query)
    query.lt.mockReturnValue(query)
    query.order.mockReturnValue(query)
    const result = await listOverdueScheduledAppointments({ from: () => query }, { now, limit: 10 })
    expect(query.eq).toHaveBeenCalledWith('status', 'scheduled')
    expect(query.lt).toHaveBeenCalledWith('scheduled_at', '2026-09-23T15:00:00.000Z')
    expect(query.update).not.toHaveBeenCalled()
    expect(query.insert).not.toHaveBeenCalled()
    expect(result.rows.map((row) => row.id)).toEqual(['appt-old'])
    expect(result.error).toBeNull()
  })

  it('keeps the nightly check read-only', () => {
    const route = readFileSync('src/app/api/cron/appointment-outcomes/route.ts', 'utf8')
    const reader = readFileSync('src/lib/server/overdue-appointment-outcomes.ts', 'utf8')
    expect(route).toContain('listOverdueScheduledAppointments')
    expect(route).not.toMatch(/\.update\(|\.insert\(|\.delete\(|\.rpc\(/)
    expect(reader).not.toMatch(/\.update\(|\.insert\(|\.delete\(|\.rpc\(/)
  })
})
