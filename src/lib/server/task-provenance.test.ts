import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc }),
}))

import { getTaskProvenanceSummary, TaskProvenanceError } from './task-provenance'

const databaseSummary = {
  schemaVersion: 1,
  department: 'acquisitions',
  total: 208,
  active: 193,
  completed: 15,
  classes: {
    legacy_operator: { total: 47, active: 37 },
    event_derived: { total: 13, active: 12 },
    automation_unreviewed: { total: 68, active: 68 },
    unknown: { total: 80, active: 76 },
  },
  knownSources: {
    mojo_auto_evaluate: 21,
    mojo_sync: 18,
    mojo_batch_evaluation: 10,
    mojo: 9,
    batch_briefing_v2: 10,
    lead_detail_task: 40,
    calendar: 7,
    website_form: 4,
    direct_inbound_intake: 1,
  },
  quality: {
    missingSource: 88,
    missingActor: 208,
    withoutEventEvidence: 195,
    missingDueDate: 16,
    unlinked: 3,
    possibleDuplicateRows: 13,
    olderThan60DaysActive: 164,
  },
}

function sourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(?:ts|tsx)$/.test(entry) && !/\.test\./.test(entry) ? [path] : []
  })
}

describe('task provenance census', () => {
  beforeEach(() => vi.clearAllMocks())

  it('parses aggregate-only source evidence and never claims quarantine occurred', async () => {
    rpc.mockResolvedValue({ data: databaseSummary, error: null })
    const result = await getTaskProvenanceSummary(new Date('2026-08-22T21:00:00.000Z'))

    expect(rpc).toHaveBeenCalledWith('task_provenance_summary_v1', { p_department: 'acquisitions' })
    expect(result).toMatchObject({
      generatedAt: '2026-08-22T21:00:00.000Z',
      source: 'aggregate_database_census',
      total: 208,
      active: 193,
      quarantineApplied: false,
      classes: {
        approved_workflow: { total: 0, active: 0 },
        governed_human: { total: 0, active: 0 },
        automation_unreviewed: { total: 68, active: 68 },
      },
    })
    expect(JSON.stringify(result)).not.toContain('title')
    expect(JSON.stringify(result)).not.toContain('leadId')
  })

  it('fails closed on database and malformed aggregate responses', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'missing function' } })
    await expect(getTaskProvenanceSummary()).rejects.toBeInstanceOf(TaskProvenanceError)

    rpc.mockResolvedValueOnce({ data: { ...databaseSummary, total: -1 }, error: null })
    await expect(getTaskProvenanceSummary()).rejects.toBeInstanceOf(TaskProvenanceError)
  })

  it('keeps the census service-role-only and does not mutate source rows', () => {
    const sql = readFileSync('supabase/migrations/20260907120000_task_provenance_census.sql', 'utf8')
    expect(sql).toContain('REVOKE ALL ON FUNCTION public.task_provenance_summary_v1(text) FROM PUBLIC, anon, authenticated')
    expect(sql).toContain('GRANT EXECUTE ON FUNCTION public.task_provenance_summary_v1(text) TO service_role')
    expect(sql).not.toMatch(/\b(?:UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\s+public\.(?:work_items|lead_activities)\b/i)
  })

  it('prevents the website booking audit row from becoming another authoritative task', () => {
    const route = readFileSync('src/app/api/book/route.ts', 'utf8')
    const marker = 'Call booked via /call page'
    const start = route.lastIndexOf("await supabase.from('lead_activities').insert({", route.indexOf(marker))
    const block = route.slice(start, route.indexOf('})', route.indexOf(marker)) + 2)
    expect(block).toContain("activity_type: 'status_change'")
    expect(block).toContain("source: 'website_booking_event'")
    expect(block).not.toContain("activity_type: 'task'")
  })

  it('keeps every AI implementation proposal-only at the source boundary', () => {
    const files = [
      ...sourceFiles('src/app/api/ai'),
      ...sourceFiles('src/lib/ai'),
    ]
    const source = files.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(source).not.toMatch(/\bcreateWorkItem\s*\(/)
    expect(source).not.toMatch(/activity_type\s*:\s*['"](?:task|follow_up|callback|send_offer)['"]/)

    const nextActionRoute = readFileSync('src/app/api/ai/next-action-proposal/route.ts', 'utf8')
    expect(nextActionRoute).toContain("execution: 'proposal_only'")
    expect(nextActionRoute).toContain('approvalRequired: true')
  })
})
