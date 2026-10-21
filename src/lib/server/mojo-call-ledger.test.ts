import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  applyCrmMojoCallUpsert,
  assertMojoCallFact,
  compareMojoCallBackfill,
  expectedMojoCallCounts,
  listAllMojoCalls,
  mapOfficialListCall,
  mapRecordingReportRow,
  parseMojoCallBackfillArgs,
  readMojoSessionId,
  runMojoCallBackfill,
  summarizeMojoCallBackfill,
  upsertCrmMojoCalls,
  type MojoCallDb,
  type MojoCallFact,
  type MojoCallLedgerRow,
  type MojoCallSource,
} from './mojo-call-ledger'
import {
  createMojoCallSource,
  createOfficialMojoCallSource,
  createSessionRecordingCallSource,
  mojoMcpCredentialState,
  pageFromListCalls,
} from './mojo-call-source'
const migration = fs.readFileSync('supabase/migrations/20261127120000_crm_mojo_calls.sql', 'utf8')
const ledgerSource = fs.readFileSync('src/lib/server/mojo-call-ledger.ts', 'utf8')
const sourceAdapter = fs.readFileSync('src/lib/server/mojo-call-source.ts', 'utf8')
const meaningfulSync = fs.readFileSync('scripts/mojo-sync.mjs', 'utf8')

const officialRaw = {
  id: 31942,
  create_date: '2026-10-19T14:12:38.446451-04:00',
  phone_number: '(***) ***-2562',
  caller_number: '(***) ***-4701',
  duration: 0,
  result: 11,
  result_code: 11,
  result_label: 'No Answer',
  type_represent: 'Power Dial',
  dial_session_id: 476,
  is_manual: false,
  is_recorded: false,
  is_note_taken: false,
  appointment_count: 0,
  appointment_exists: 0,
  lead_exists: 0,
  agent_name: 'Casey Davis',
  contact_id: 5799,
  contact_initials: 'K.N.',
}

function officialCall(id: number, iso: string, session: number | null = null, label = 'No Answer'): MojoCallFact {
  return mapOfficialListCall({
    ...officialRaw,
    id,
    create_date: iso,
    dial_session_id: session,
    result_label: label,
  })
}

function memoryDb(leads: Record<string, string[]> = {}) {
  const rows = new Map<string, MojoCallLedgerRow>()
  const tables: string[] = []
  const db: MojoCallDb & { from: (table: string) => never } = {
    from(table: string) {
      tables.push(table)
      throw new Error(`unexpected table ${table}`)
    },
    async rpc(fn, args) {
      if (fn !== 'upsert_crm_mojo_call_v1') throw new Error(fn)
      const matches = args.p_call.provider_contact_id ? leads[args.p_call.provider_contact_id] ?? [] : []
      const leadId = matches.length === 1 ? matches[0] : null
      const outcome = applyCrmMojoCallUpsert(rows.get(args.p_call.record_id) ?? null, args.p_call, leadId)
      if (!outcome.replayed) rows.set(outcome.row.record_id, outcome.row)
      return {
        data: { recordId: outcome.row.record_id, leadId: outcome.row.lead_id, replayed: outcome.replayed, inserted: outcome.inserted },
        error: null,
      }
    },
  }
  return { db, rows, tables }
}

describe('per-call Mojo mapping', () => {
  it('maps an official list_calls row onto mojo-call-<id> with initials and the last four digits', () => {
    const mapped = mapOfficialListCall(officialRaw)
    expect(mapped).toMatchObject({
      record_id: 'mojo-call-31942',
      provider_call_id: '31942',
      provider_contact_id: '5799',
      dial_session_id: '476',
      contact_initials: 'K.N.',
      phone_last4: '2562',
      duration_seconds: 0,
      result_code: 11,
      result_label: 'No Answer',
      is_recorded: false,
      appointment_count: 0,
      lead_exists: false,
      source: 'mojo_mcp_list_calls',
    })
    const serialized = JSON.stringify(mapped)
    expect(serialized).not.toContain('4701')
    expect(serialized).not.toContain('Casey')
    expect(serialized).not.toContain('Davis')
    expect(serialized).not.toContain('phone_number')
  })

  it('keeps only the last four digits when a full phone is offered and drops a full name', () => {
    const mapped = mapOfficialListCall({
      ...officialRaw,
      phone_number: '8165551212',
      contact_initials: 'Kim Nguyen',
    })
    expect(mapped.phone_last4).toBe('1212')
    expect(mapped.contact_initials).toBeNull()
    expect(JSON.stringify(mapped)).not.toContain('8165551212')
    expect(JSON.stringify(mapped)).not.toContain('Nguyen')
  })

  it('maps a recording only when it carries a call id and never copies the contact name', () => {
    expect(mapRecordingReportRow({
      record_id: 99999999,
      contact: { id: 7, name: 'Kim Nguyen', phone: '8165551212' },
      duration: '0:05',
      result: 'No Answer',
    })).toBeNull()
    const mapped = mapRecordingReportRow({
      call_id: 31597,
      record_id: 888,
      contact: { id: 8, name: 'Pat Example', phone: '9135550199' },
      contact_initials: 'P.E.',
      duration: 12,
      result: 'No Answer',
      create_date: '2026-10-19T16:00:00.000Z',
      dial_session_id: 474,
    })
    expect(mapped).toMatchObject({
      record_id: 'mojo-call-31597',
      provider_contact_id: '8',
      contact_initials: 'P.E.',
      phone_last4: '0199',
      is_recorded: true,
      source: 'mojo_session_recordings',
      dial_session_id: '474',
    })
    expect(JSON.stringify(mapped)).not.toContain('Pat')
    expect(JSON.stringify(mapped)).not.toContain('9135550199')
    expect(JSON.stringify(mapped)).not.toContain('888')
  })

  it('rejects a payload that still has a phone, name, or activity identity', () => {
    expect(() => assertMojoCallFact({ ...officialCall(1, '2026-10-19T18:00:00.000Z'), phone_number: '8165551212' })).toThrow('forbidden_field')
    expect(() => mapOfficialListCall({ ...officialRaw, id: 'mojo-activity-7-81' })).toThrow('invalid_mojo_call_id')
  })
})

describe('per-call upsert isolation', () => {
  it('replays the same call without writing the queue or changing DNC', async () => {
    const queue = [{ record_id: 'mojo-activity-7-81', status: 'pending' }]
    const dnc = ['+19135550100']
    const { db, rows, tables } = memoryDb({ '5799': ['lead-1'] })
    const call = officialCall(31942, '2026-10-19T18:12:38.446Z', 476, 'Do Not Call')
    const first = await upsertCrmMojoCalls(db, [call])
    const second = await upsertCrmMojoCalls(db, [call])
    expect(first[0]).toMatchObject({ recordId: 'mojo-call-31942', leadId: 'lead-1', inserted: true, replayed: false })
    expect(second[0]).toMatchObject({ recordId: 'mojo-call-31942', leadId: 'lead-1', inserted: false, replayed: true })
    expect(rows.size).toBe(1)
    expect(tables).toEqual([])
    expect(queue).toEqual([{ record_id: 'mojo-activity-7-81', status: 'pending' }])
    expect(dnc).toEqual(['+19135550100'])
    expect(JSON.stringify(ledgerSource)).not.toContain('mojo_call_queue')
    expect(JSON.stringify(ledgerSource)).not.toContain('suppressMojoDnc')
    expect(JSON.stringify(sourceAdapter)).not.toContain('sms_opt_outs')
  })

  it('matches a lead only when one Mojo contact id is already linked', async () => {
    const unique = memoryDb({ '5799': ['lead-1'] })
    await upsertCrmMojoCalls(unique.db, [officialCall(1, '2026-10-19T18:00:00.000Z')])
    expect(unique.rows.get('mojo-call-1')?.lead_id).toBe('lead-1')

    const ambiguous = memoryDb({ '5799': ['lead-1', 'lead-2'] })
    await upsertCrmMojoCalls(ambiguous.db, [officialCall(2, '2026-10-19T18:00:00.000Z')])
    expect(ambiguous.rows.get('mojo-call-2')?.lead_id).toBeNull()

    const unmatched = memoryDb({ '111': ['lead-9'] })
    await upsertCrmMojoCalls(unmatched.db, [officialCall(3, '2026-10-19T18:00:00.000Z')])
    expect(unmatched.rows.get('mojo-call-3')?.lead_id).toBeNull()
  })

  it('updates changed facts in place and does not insert a second row', () => {
    const first = applyCrmMojoCallUpsert(null, officialCall(5, '2026-10-19T18:00:00.000Z', 476), null)
    const replay = applyCrmMojoCallUpsert(first.row, officialCall(5, '2026-10-19T18:00:00.000Z', 476), null)
    const changed = applyCrmMojoCallUpsert(first.row, officialCall(5, '2026-10-19T18:05:00.000Z', 476), null)
    expect(replay).toMatchObject({ replayed: true, inserted: false, row: first.row })
    expect(changed).toMatchObject({ replayed: false, inserted: false })
    expect(changed.row.call_at).not.toBe(first.row.call_at)
  })
})

describe('crm_mojo_calls migration', () => {
  it('keeps the per-call ledger private and service-role only', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.crm_mojo_calls')
    expect(migration).toContain("CHECK (record_id ~ '^mojo-call-[0-9]{1,18}$')")
    expect(migration).toContain('ALTER TABLE public.crm_mojo_calls ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE public.crm_mojo_calls FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.crm_mojo_calls TO service_role')
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.upsert_crm_mojo_call_v1(jsonb)')
  })

  it('upserts on the call id, matches by Mojo contact id, and leaves the meaningful pipeline alone', () => {
    const fn = migration.split('CREATE OR REPLACE FUNCTION public.upsert_crm_mojo_call_v1')[1] || ''
    expect(fn).toContain("pg_catalog.hashtextextended('crm-mojo-call:' || record_value, 0)")
    expect(fn).toContain('ON CONFLICT (record_id) DO UPDATE')
    expect(fn).toContain("'replayed', true")
    expect(fn).toContain('event.provider_contact_id = contact_value')
    expect(fn).toContain('IF match_count IS DISTINCT FROM 1')
    expect(fn).not.toContain('normalize_conversation_phone')
    expect(fn).not.toMatch(/INSERT INTO public\.leads|UPDATE public\.leads|INSERT INTO public\.lead_activities|INSERT INTO public\.work_items/i)
    expect(fn).not.toMatch(/INSERT INTO public\.mojo_call_queue|UPDATE public\.mojo_call_queue|DELETE FROM public\.mojo_call_queue/i)
    expect(fn).not.toMatch(/sms_opt_outs/i)
    expect(meaningfulSync).toContain('record_id: `mojo-activity-${contactId}-${canonicalActivityId}`')
    expect(ledgerSource).not.toContain('mojo-activity-')
  })
})

describe('October 9-19 backfill', () => {
  it('expects 249 calls on the 9th, 346 on the 19th, and none between', () => {
    const counts = expectedMojoCallCounts()
    expect(counts['2026-10-09']).toBe(249)
    expect(counts['2026-10-19']).toBe(346)
    for (const day of ['10', '11', '12', '13', '14', '15', '16', '17', '18']) {
      expect(counts[`2026-10-${day}`]).toBe(0)
    }
    const calls = [
      ...Array.from({ length: 249 }, (_, index) => officialCall(20000 + index, '2026-10-09T18:00:00.000Z')),
      ...Array.from({ length: 346 }, (_, index) => officialCall(
        31597 + index,
        '2026-10-19T18:00:00.000Z',
        index < 3 ? 474 : index < 50 ? 475 : 476,
      )),
    ]
    const summary = summarizeMojoCallBackfill(calls, '2026-10-09', '2026-10-19')
    expect(compareMojoCallBackfill(summary)).toMatchObject({
      matches: true,
      dailyMismatches: [],
      sessionMismatches: [],
      callIdsMatch: true,
    })
    expect(summary.sessions).toEqual({ '474': 3, '475': 47, '476': 296 })
    expect(summary.callIds).toEqual({ min: 31597, max: 31942, count: 346 })
  })

  it('dry-runs by default and does not call the database', async () => {
    expect(parseMojoCallBackfillArgs([])).toEqual({ apply: false, dryRun: true })
    expect(parseMojoCallBackfillArgs(['--apply'])).toEqual({ apply: true, dryRun: false })
    const rpc = vi.fn()
    const source: MojoCallSource = {
      kind: 'mojo_mcp_list_calls',
      async listCalls() {
        return { totalCount: 0, totalPages: 1, page: 1, results: [], skippedUnkeyed: 0 }
      },
    }
    const result = await runMojoCallBackfill({ source, apply: false, db: { rpc } })
    expect(result.dryRun).toBe(true)
    expect(result.written).toBe(0)
    expect(rpc).not.toHaveBeenCalled()
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mojo-session-'))
    const file = path.join(directory, 'session.json')
    fs.writeFileSync(file, JSON.stringify({ sessionId: 'present', expired: true }))
    expect(readMojoSessionId(file)).toBeNull()
    fs.rmSync(directory, { recursive: true, force: true })
  })

  it('pages the official source and reports missing OAuth without using the cookie as a token', async () => {
    const seen: unknown[] = []
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      seen.push(JSON.parse(String(init?.body)))
      const method = (JSON.parse(String(init?.body)) as { method?: string }).method
      if (method === 'initialize') {
        return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2025-03-26' } }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'mcp-session-id': 'session-1' },
        })
      }
      if (method === 'notifications/initialized') return new Response('', { status: 202 })
      return new Response(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify({ total_count: 1, total_pages: 1, page: 1, results: [officialRaw] }),
          }],
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const source = createOfficialMojoCallSource({ accessToken: 'test-token', fetchImpl })
    const page = await source.listCalls({ dateFrom: '2026-10-19', dateTo: '2026-10-19', page: 1, pageSize: 500 })
    expect(page.results[0]?.record_id).toBe('mojo-call-31942')
    expect(fetchImpl.mock.calls[2]?.[1]?.headers).toMatchObject({ authorization: 'Bearer test-token', 'mcp-session-id': 'session-1' })
    expect(JSON.stringify(seen[2])).toContain('"name":"list_calls"')
    expect(JSON.stringify(fetchImpl.mock.calls[2]?.[1]?.headers)).not.toContain('sessionid=')

    const paged: MojoCallSource = {
      kind: 'mojo_mcp_list_calls',
      async listCalls({ page = 1 }) {
        const row = officialCall(page === 1 ? 31597 : 31598, '2026-10-19T18:00:00.000Z', 476)
        return { totalCount: 2, totalPages: 2, page, results: [row], skippedUnkeyed: 0 }
      },
    }
    expect((await listAllMojoCalls(paged, '2026-10-19', '2026-10-19')).calls.map((row) => row.provider_call_id)).toEqual(['31597', '31598'])

    const emptyEnv = { NODE_ENV: 'test' } as NodeJS.ProcessEnv
    expect(mojoMcpCredentialState(emptyEnv)).toMatchObject({
      mode: 'missing',
      missing: ['MOJO_MCP_ACCESS_TOKEN', 'MOJO_MCP_CLIENT_ID', 'MOJO_MCP_CLIENT_SECRET', 'MOJO_MCP_REFRESH_TOKEN'],
    })
    const selected = createMojoCallSource({ env: emptyEnv, sessionId: 'scraper-session' })
    expect(selected.source?.kind).toBe('mojo_session_recordings')
    expect(pageFromListCalls({ total_count: 0, total_pages: 0, page: 1, results: [] }, 1).totalCount).toBe(0)
  })

  it('uses the recording report as the fallback and skips rows that are not call ids', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/v2/rest/reports/call-recording-report-data/')
      expect((init?.headers as { cookie?: string } | undefined)?.cookie).toBe('sessionid=scraper-session')
      return new Response(JSON.stringify({
        recordings: [
          { record_id: 42, contact: { id: 7, name: 'Kim Nguyen' }, duration: '0:01', result: 'No Answer' },
          { call_id: 31597, contact: { id: 8, name: 'Pat Example' }, contact_initials: 'P.E.', duration: 3, result: 'No Answer', create_date: '2026-10-19T16:00:00.000Z' },
        ],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const source = createSessionRecordingCallSource({ sessionId: 'scraper-session', fetchImpl })
    const page = await source.listCalls({ dateFrom: '2026-10-09', dateTo: '2026-10-19', page: 1, pageSize: 500 })
    expect(page.skippedUnkeyed).toBe(1)
    expect(page.results).toHaveLength(1)
    expect(page.results[0]?.record_id).toBe('mojo-call-31597')
    expect(JSON.stringify(page.results)).not.toContain('Nguyen')
    const unavailable = createMojoCallSource({ env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv, sessionId: null })
    expect(unavailable).toMatchObject({ source: null, auth: { mode: 'missing' } })
  })
})
