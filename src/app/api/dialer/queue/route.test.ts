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

  it('keeps every supporting read scoped and returns a compact queue contract', () => {
    expect(routeSource.match(/\.in\('lead_id', leadIds\)/g)).toHaveLength(4)
    expect(routeSource).toContain(".or('station.is.null,station.not.in.(dead,closed_lost)')")
    expect(routeSource).toContain(".or('classification.is.null,classification.neq.dead')")
    expect(routeSource).toContain(".eq('is_opted_out', true)")
    expect(routeSource).toContain('queueContext: context')
    expect(routeSource).toContain('queueMetrics: metrics')
    expect(routeSource).toContain("'Server-Timing'")
    expect(routeSource).not.toContain('followups: followups || []')
    expect(routeSource).not.toContain('contactActivities: contactActivities || []')
    expect(pageSource).not.toContain('QueueContactActivity')
    expect(pageSource).not.toContain('QueueFollowup')
  })
})
