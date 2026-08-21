import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const route = readFileSync('src/app/api/reports/operating/route.ts', 'utf8')

describe('operating report route source contract', () => {
  it('filters high-volume sources by the requested period before loading rows', () => {
    expect(route).toContain(".lte('created_at', until.toISOString())")
    expect(route).toContain("activityQuery = activityQuery.gte('created_at', since.toISOString())")
    expect(route).toContain("revenueQuery = revenueQuery.gte('date', since.toISOString().slice(0, 10))")
    expect(route).toContain("expensesQuery = expensesQuery.gte('date', since.toISOString().slice(0, 10))")
  })

  it('uses explicit caps instead of offset-paging the entire activity history', () => {
    expect(route).toContain('OPERATING_REPORT_ACTIVITY_LIMIT + 1')
    expect(route).toContain('OPERATING_REPORT_ROW_LIMIT + 1')
    expect(route).not.toContain('.range(')
  })

  it('reads current attention and next actions from the authoritative projection', () => {
    expect(route).toContain(".from('conversation_thread_state')")
    expect(route).toContain('conversationStatesToThreads(stateRows, until)')
    expect(route).not.toContain('buildConversationHubThreads')
  })

  it('returns generic failures and source row timing without leaking database errors', () => {
    expect(route).toContain('Operating report data is temporarily unavailable.')
    expect(route).toContain("'Server-Timing'")
    expect(route).not.toContain("NextResponse.json({ error: leadError.message }")
  })
})
