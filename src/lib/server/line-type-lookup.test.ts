import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AssistantActor } from '@/lib/assistant/auth'
import {
  chicagoDayStart,
  CRM_LINE_TYPE_LOOKUP_TOOL,
  LINE_TYPE_LOOKUP_AUDIT_ACTION,
  LINE_TYPE_LOOKUP_DAILY_CAP,
  LINE_TYPE_LOOKUP_FIELDS,
  lineTypeLookupCsv,
  mapLookupLineType,
  readLineTypeLookupCredentials,
  runLineTypeLookup,
  type LineTypeLookupAuditDb,
  type LineTypeLookupRow,
} from './line-type-lookup'

const NOW = new Date('2026-11-19T18:00:00.000Z')
const DAY_START = '2026-11-19T06:00:00.000Z'
const ACTOR: AssistantActor = {
  email: 'owner@savingkc.com',
  fullName: 'Owner',
  role: 'owner',
  access: 'owner',
}
const ENV = {
  TWILIO_ACCOUNT_SID: 'AC123',
  TWILIO_API_KEY: 'SK123',
  TWILIO_API_SECRET: 'secret123',
  TWILIO_AUTH_TOKEN: 'token123',
}

type StoredAudit = {
  id: string
  action: string
  request_id: string
  result_count: number | null
  success: boolean
  created_at: string
  payload: Record<string, unknown>
}

function lookupBody(type: string, carrier = 'T-Mobile', valid = true) {
  return {
    valid,
    line_type_intelligence: { type, carrier_name: carrier, error_code: null },
  }
}

function createAudit(initial: StoredAudit[] = []) {
  const rows = [...initial]
  const inserted: Record<string, unknown>[] = []
  let plantCompetitor: StoredAudit | null = null
  const db: LineTypeLookupAuditDb = {
    from(table: string) {
      if (table !== 'assistant_query_audit') throw new Error(`unexpected table ${table}`)
      const filters: Array<(row: StoredAudit) => boolean> = []
      const query = {
        select() { return query },
        eq(column: string, value: unknown) {
          filters.push((row) => row[column as keyof StoredAudit] === value)
          return query
        },
        gte(column: string, value: string) {
          filters.push((row) => String(row[column as keyof StoredAudit]) >= value)
          return query
        },
        order() { return query },
        range(from: number, to: number) {
          const matched = rows.filter((row) => filters.every((filter) => filter(row)))
          return Promise.resolve({ data: matched.slice(from, to + 1), error: null })
        },
        insert(row: Record<string, unknown>) {
          inserted.push(row)
          if (plantCompetitor && Number(row.result_count) > 0) {
            rows.push(plantCompetitor)
            plantCompetitor = null
          }
          rows.push({
            id: `id-${rows.length + 1}`,
            action: String(row.action),
            request_id: String(row.request_id),
            result_count: Number(row.result_count),
            success: row.success === true,
            created_at: NOW.toISOString(),
            payload: row,
          })
          return Promise.resolve({ error: null })
        },
      }
      return query
    },
  }
  return {
    db,
    inserted,
    rows,
    plant(row: StoredAudit) { plantCompetitor = row },
  }
}

function seed(count: number, createdAt = '2026-11-19T16:00:00.000Z'): StoredAudit {
  return {
    id: `seed-${createdAt}-${count}`,
    action: LINE_TYPE_LOOKUP_AUDIT_ACTION,
    request_id: `seed-${createdAt}`,
    result_count: count,
    success: true,
    created_at: createdAt,
    payload: {},
  }
}

function phones(count: number, start = 0): string[] {
  return Array.from({ length: count }, (_, index) => `816555${String(start + index).padStart(4, '0')}`)
}

async function run(input: {
  phones: unknown
  fetchImpl?: typeof fetch
  db?: LineTypeLookupAuditDb
  env?: Record<string, string | undefined>
  sideEffectsDisabled?: boolean
  actor?: AssistantActor
  sleep?: (ms: number) => Promise<void>
}) {
  return runLineTypeLookup({
    actor: input.actor ?? ACTOR,
    phones: input.phones,
    threadId: 'thread-1',
    requestId: 'request-1',
    deps: {
      env: input.env ?? ENV,
      fetchImpl: input.fetchImpl ?? vi.fn(),
      db: input.db ?? createAudit().db,
      now: () => NOW,
      sleep: input.sleep ?? (async () => {}),
      sideEffectsDisabled: input.sideEffectsDisabled ?? false,
    },
  })
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('line type lookup credentials and calendar', () => {
  it('names the Twilio env vars when no usable credentials exist', () => {
    expect(readLineTypeLookupCredentials({})).toMatchObject({
      ok: false,
      missing: ['TWILIO_ACCOUNT_SID', 'TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_AUTH_TOKEN'],
    })
    const accountOnly = readLineTypeLookupCredentials({ TWILIO_ACCOUNT_SID: 'AC123' })
    expect(accountOnly.ok).toBe(false)
    if (!accountOnly.ok) {
      expect(accountOnly.missing).toEqual(['TWILIO_API_KEY', 'TWILIO_API_SECRET', 'TWILIO_AUTH_TOKEN'])
    }
  })

  it('prefers the API key pair and falls back to the auth token', () => {
    expect(readLineTypeLookupCredentials(ENV)).toMatchObject({
      ok: true,
      credentials: { username: 'SK123', password: 'secret123' },
    })
    expect(readLineTypeLookupCredentials({
      TWILIO_ACCOUNT_SID: 'AC123',
      TWILIO_AUTH_TOKEN: 'token123',
    })).toMatchObject({ ok: true, credentials: { username: 'AC123', password: 'token123' } })
  })

  it('starts the Chicago day at local midnight, including the DST boundaries', () => {
    expect(chicagoDayStart(NOW).toISOString()).toBe(DAY_START)
    expect(chicagoDayStart(new Date('2026-11-19T05:30:00.000Z')).toISOString()).toBe('2026-11-18T06:00:00.000Z')
    expect(chicagoDayStart(new Date('2026-07-15T15:00:00.000Z')).toISOString()).toBe('2026-07-15T05:00:00.000Z')
    expect(chicagoDayStart(new Date('2026-03-08T18:00:00.000Z')).toISOString()).toBe('2026-03-08T06:00:00.000Z')
    expect(chicagoDayStart(new Date('2026-11-01T18:00:00.000Z')).toISOString()).toBe('2026-11-01T05:00:00.000Z')
  })

  it('keeps only the line types this check reports', () => {
    expect(mapLookupLineType('mobile')).toBe('mobile')
    expect(mapLookupLineType('landline')).toBe('landline')
    expect(mapLookupLineType('fixedVoip')).toBe('fixedVoip')
    expect(mapLookupLineType('nonFixedVoip')).toBe('nonFixedVoip')
    expect(mapLookupLineType('tollFree')).toBe('tollFree')
    expect(mapLookupLineType('personal')).toBe('unknown')
    expect(mapLookupLineType('')).toBe('unknown')
  })
})

describe('runLineTypeLookup', () => {
  it('does not reference prospect, phone, DNC, or TCPA writes', () => {
    const source = readFileSync('src/lib/server/line-type-lookup.ts', 'utf8')
    expect(source).toContain(`Fields=\${LINE_TYPE_LOOKUP_FIELDS}`)
    expect(LINE_TYPE_LOOKUP_FIELDS).toBe('line_type_intelligence')
    expect(CRM_LINE_TYPE_LOOKUP_TOOL).toBe('crm_line_type_lookup')
    expect(source).not.toMatch(/prospect_phones|phone_line_checks|sms_opt_outs|from\(['"]prospect|from\(['"]phone/)
  })

  it('looks up each unique number once and returns one row per input plus CSV', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      void init
      const phone = decodeURIComponent(String(url).split('/PhoneNumbers/')[1]?.split('?')[0] ?? '')
      const type = phone.endsWith('0100') ? 'nonFixedVoip' : 'landline'
      return new Response(JSON.stringify(lookupBody(type, 'Verizon, Wireless')), { status: 200 })
    })
    const audit = createAudit([seed(4), seed(50, '2026-11-18T16:00:00.000Z')])
    const result = await run({
      phones: ['8165550100', '+1 (816) 555-0100', '8165550101', 'not-a-phone'],
      fetchImpl,
      db: audit.db,
    })

    expect(result.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    const firstUrl = String(fetchImpl.mock.calls[0]?.[0])
    expect(firstUrl).toContain('Fields=line_type_intelligence')
    expect(firstUrl).not.toContain('line_status')
    const authorization = new Headers(fetchImpl.mock.calls[0]?.[1]?.headers).get('Authorization') ?? ''
    expect(Buffer.from(authorization.slice(6), 'base64').toString()).toBe('SK123:secret123')
    expect(result.body.rows).toEqual([
      expect.objectContaining({ e164: '+18165550100', valid: true, line_type: 'nonFixedVoip', carrier: 'Verizon, Wireless', error: null }),
      expect.objectContaining({ e164: '+18165550100', valid: true, line_type: 'nonFixedVoip' }),
      expect.objectContaining({ e164: '+18165550101', valid: true, line_type: 'landline' }),
      expect.objectContaining({ e164: 'not-a-phone', valid: false, line_type: 'unknown', error: 'invalid_phone' }),
    ])
    expect(result.body.csv?.split('\n')[0]).toBe('e164,valid,line_type,carrier,checked_at')
    expect(result.body.csv).toContain('"+18165550100",true,nonFixedVoip,"Verizon, Wireless",2026-11-19T18:00:00.000Z')
    expect(result.body.usage).toMatchObject({
      timezone: 'America/Chicago',
      day: '2026-11-19',
      limit: 1000,
      usedToday: 6,
      remaining: 994,
      counted: 2,
      costGuard: 'daily_cap',
      pricePerLookupUsd: 0.015,
    })
    expect(audit.inserted).toHaveLength(1)
    expect(audit.inserted[0]).toMatchObject({
      action: LINE_TYPE_LOOKUP_AUDIT_ACTION,
      result_count: 2,
      success: true,
      actor_email: ACTOR.email,
    })
    expect(JSON.stringify(audit.inserted)).not.toContain('8165550100')
    expect(JSON.stringify(audit.inserted)).not.toContain('+18165550100')
  })

  it('retries a 429 and then keeps the successful lookup', async () => {
    const sleeps: number[] = []
    let calls = 0
    const fetchImpl = vi.fn(async () => {
      calls += 1
      if (calls === 1) return new Response('slow', { status: 429, headers: { 'retry-after': '1' } })
      return new Response(JSON.stringify(lookupBody('mobile')), { status: 200 })
    })
    const result = await run({
      phones: ['8165550102'],
      fetchImpl,
      sleep: async (ms) => { sleeps.push(ms) },
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(sleeps).toEqual([1000])
    expect(result.body.rows?.[0]).toMatchObject({ e164: '+18165550102', valid: true, line_type: 'mobile', carrier: 'T-Mobile', error: null })
  })

  it('keeps at most five lookups in flight', async () => {
    let active = 0
    let maxActive = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    const fetchImpl = vi.fn(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await gate
      active -= 1
      return new Response(JSON.stringify(lookupBody('tollFree', 'Toll')), { status: 200 })
    })
    const pending = run({ phones: phones(6), fetchImpl })
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(5))
    expect(maxActive).toBe(5)
    release()
    const result = await pending
    expect(fetchImpl).toHaveBeenCalledTimes(6)
    expect(result.body.rows).toHaveLength(6)
    expect(result.body.usage?.counted).toBe(6)
  })

  it('records a row error without dropping the input when Twilio fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 500 }))
    const result = await run({ phones: ['8165550103'], fetchImpl })
    expect(result.status).toBe(200)
    expect(result.body.rows?.[0]).toMatchObject({ valid: false, line_type: 'unknown', carrier: '', error: 'lookup_failed' })
    expect(result.body.usage?.counted).toBe(1)
    expect(result.body.csv).toContain(',false,unknown,,')
  })

  it('refuses a request that would pass the Chicago-day cap and does not call Twilio', async () => {
    const fetchImpl = vi.fn()
    const audit = createAudit([seed(900)])
    const result = await run({ phones: phones(101), fetchImpl, db: audit.db })

    expect(result.status).toBe(429)
    expect(result.body).toMatchObject({
      ok: false,
      error: 'daily_lookup_cap',
      usage: { usedToday: 900, remaining: 100, counted: 0, limit: LINE_TYPE_LOOKUP_DAILY_CAP },
    })
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(audit.inserted).toHaveLength(0)
  })

  it('allows a request that lands exactly on the daily cap', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(lookupBody('mobile')), { status: 200 }))
    const result = await run({ phones: phones(100), fetchImpl, db: createAudit([seed(900)]).db })
    expect(result.status).toBe(200)
    expect(fetchImpl).toHaveBeenCalledTimes(100)
    expect(result.body.usage).toMatchObject({ usedToday: 1000, remaining: 0, counted: 100 })
  })

  it('releases a reservation that lost the cap race and does not call Twilio', async () => {
    const fetchImpl = vi.fn()
    const audit = createAudit([seed(900)])
    audit.plant({
      id: 'competitor',
      action: LINE_TYPE_LOOKUP_AUDIT_ACTION,
      request_id: 'competitor',
      result_count: 100,
      success: true,
      created_at: NOW.toISOString(),
      payload: {},
    })
    const result = await run({ phones: phones(50), fetchImpl, db: audit.db })

    expect(result.status).toBe(429)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(audit.inserted.map((row) => row.result_count)).toEqual([50, -50])
    expect(audit.inserted[1]?.error).toBe('cap_race_released')
    expect(result.body.usage).toMatchObject({ counted: 0, usedToday: 1000, remaining: 0 })
  })

  it('stops before Twilio when credentials are missing', async () => {
    const fetchImpl = vi.fn()
    const audit = createAudit()
    const result = await run({ phones: ['8165550100'], fetchImpl, db: audit.db, env: {} })
    expect(result.status).toBe(503)
    expect(result.body.missing).toEqual([
      'TWILIO_ACCOUNT_SID',
      'TWILIO_API_KEY',
      'TWILIO_API_SECRET',
      'TWILIO_AUTH_TOKEN',
    ])
    expect(result.body.message).toContain('TWILIO_ACCOUNT_SID')
    expect(result.body.message).toContain('TWILIO_AUTH_TOKEN')
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(audit.inserted).toHaveLength(0)
  })

  it('does not call Twilio outside production', async () => {
    const fetchImpl = vi.fn()
    const result = await run({ phones: ['8165550100'], fetchImpl, sideEffectsDisabled: true })
    expect(result.status).toBe(503)
    expect(result.body.error).toBe('external_side_effects_disabled')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('enforces only the per-call max when the counter table is missing', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(lookupBody('fixedVoip', 'Comcast')), { status: 200 }))
    const db: LineTypeLookupAuditDb = {
      from() {
        const query = {
          select() { return query },
          eq() { return query },
          gte() { return query },
          order() { return query },
          range: async () => ({ data: null, error: { code: 'PGRST205', message: 'missing' } }),
          insert: async () => ({ error: null }),
        }
        return query
      },
    }
    const result = await run({ phones: ['8165550104'], fetchImpl, db })
    expect(result.status).toBe(200)
    expect(result.body.usage).toMatchObject({ costGuard: 'per_call_max', limit: 200, usedToday: null, remaining: null, counted: 1 })
    expect(result.body.message).toContain('per-call maximum of 200')
    expect(result.body.rows?.[0]?.line_type).toBe('fixedVoip')
  })

  it('fails closed when the counter cannot be read', async () => {
    const fetchImpl = vi.fn()
    const db: LineTypeLookupAuditDb = {
      from() {
        const query = {
          select() { return query },
          eq() { return query },
          gte() { return query },
          order() { return query },
          range: async () => ({ data: null, error: { code: '57014', message: 'timeout' } }),
          insert: async () => ({ error: null }),
        }
        return query
      },
    }
    const result = await run({ phones: ['8165550100'], fetchImpl, db })
    expect(result.status).toBe(503)
    expect(result.body.error).toBe('counter_unavailable')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects an agent and an oversized batch before calling Twilio', async () => {
    const fetchImpl = vi.fn()
    const agent = await run({
      phones: ['8165550100'],
      fetchImpl,
      actor: { ...ACTOR, access: 'agent', role: 'agent' },
    })
    expect(agent.status).toBe(403)
    expect(await run({ phones: phones(201), fetchImpl })).toMatchObject({ status: 400 })
    expect(await run({ phones: [], fetchImpl })).toMatchObject({ status: 400 })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('quotes CSV cells that spreadsheets would treat as formulas', () => {
    const rows: LineTypeLookupRow[] = [{
      e164: '+18165550100',
      valid: true,
      line_type: 'unknown',
      carrier: '=cmd',
      checked_at: '2026-11-19T18:00:00.000Z',
      error: null,
    }]
    expect(lineTypeLookupCsv(rows)).toContain('"+18165550100",true,unknown,"=cmd",')
  })
})
