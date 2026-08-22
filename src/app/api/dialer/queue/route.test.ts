import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { filterDialerQueueLeads } from './route'

const routeSource = readFileSync('src/app/api/dialer/queue/route.ts', 'utf8')
const pageSource = readFileSync('src/app/(app)/dialer/page.tsx', 'utf8')

function lead(id: string, phone: string | null, station = 'new', classification = 'lead') {
  return { id, phone, station, classification }
}

describe('dialer queue safety filtering', () => {
  it('removes dead, closed-lost, classification-dead, invalid, and globally suppressed records', () => {
    const result = filterDialerQueueLeads([
      lead('safe', '(913) 555-0123'),
      lead('dead-station', '+19135550124', 'dead'),
      lead('closed-lost', '+19135550125', 'closed_lost'),
      lead('dead-classification', '+19135550126', 'new', 'dead'),
      lead('suppressed-format', '913.555.0127'),
      lead('invalid', '123'),
    ], new Set(['+19135550127']))

    expect(result.map((row) => row.id)).toEqual(['safe'])
  })

  it('uses the bounded projection and returns a compact queue contract', () => {
    expect(routeSource).toContain('readDialerQueuePage({')
    expect(routeSource).toContain('queueContext: page.queueContext')
    expect(routeSource).toContain('queueMetrics: page.queueMetrics')
    expect(routeSource).toContain("'Server-Timing'")
    expect(routeSource).not.toContain(".from('sms_opt_outs')")
    expect(routeSource).not.toContain(".from('lead_activities')")
    expect(routeSource).not.toContain('buildDialerQueueContext')
    expect(pageSource).not.toContain('QueueContactActivity')
    expect(pageSource).not.toContain('QueueFollowup')
  })
})
