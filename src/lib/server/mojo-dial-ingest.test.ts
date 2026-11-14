import fs from 'fs'
import { describe, expect, it } from 'vitest'
import { MojoDialIngestError, syncMojoDialIngest, type MojoDialIngestStore } from './mojo-dial-ingest'
import type { MojoDialReader } from './mojo-call-source'
import { mapCallingReportDial, type MojoDialWrite } from './mojo-dial-outcome'

function dial(id: number, result: string, phone = '8165550100') {
  return mapCallingReportDial({
    id,
    contact: { id: 100 + id },
    phone_number: phone,
    result,
    create_date: '2026-10-28T15:04:00-05:00',
    session: { id: 3 },
    lead_exists: false,
    appointment_exists: 0,
    is_recorded: false,
  })
}

function reader(dials: ReturnType<typeof dial>[]): MojoDialReader {
  return {
    kind: 'mojo_session_calling_report',
    async listDials() {
      return { totalCount: dials.length, totalPages: 1, page: 1, skippedUnkeyed: 0, results: dials }
    },
  }
}

function store() {
  const state: { cursor: string | null; batches: MojoDialWrite[][]; saved: Record<string, string> | null } = {
    cursor: null,
    batches: [],
    saved: null,
  }
  const api: MojoDialIngestStore = {
    async loadCursor() { return state.cursor },
    async saveState(values) {
      state.saved = values
      state.cursor = values.mojo_call_ingest_cursor ?? state.cursor
    },
    async applyBatch(calls) {
      state.batches.push(calls)
      return { calls: calls.length, eventsInserted: calls.length, eventsReplayed: 0, phonesUpdated: 1 }
    },
  }
  return { api, state }
}

describe('syncMojoDialIngest', () => {
  it('writes deduped dials and advances the backfill cursor one day', async () => {
    const db = store()
    const result = await syncMojoDialIngest({
      now: new Date('2026-11-14T18:00:00.000Z'),
      reader: reader([dial(7, 'No Answer'), dial(7, 'No Answer', '8165550100'), dial(8, 'DNC Contact', '8165550199')]),
      store: db.api,
    })
    expect(result).toMatchObject({
      ok: true,
      from: '2026-10-28',
      to: '2026-10-28',
      catchingUp: true,
      cursor: '2026-10-29',
      calls: 2,
      eventsInserted: 2,
    })
    const writes = db.state.batches[0] ?? []
    expect(writes.map((row) => row.provider_call_id).sort()).toEqual(['7', '8'])
    expect(writes.find((row) => row.provider_call_id === '8')).toMatchObject({
      phone_disposition: 'dnc',
      outcome: 'dnc',
      normalized_phone: '+18165550199',
      phone_last4: '0199',
    })
    const ledgerRows = writes.map((row) => {
      const { normalized_phone: dialedPhone, ...fact } = row
      expect(dialedPhone).toMatch(/^\+1\d{10}$/)
      return fact
    })
    expect(JSON.stringify(ledgerRows)).not.toContain('816555')
    expect(db.state.saved?.mojo_call_ingest_cursor).toBe('2026-10-29')
  })

  it('does not advance the cursor when the session is expired', async () => {
    const db = store()
    const expired: MojoDialReader = {
      kind: 'mojo_session_calling_report',
      async listDials() { throw new Error('session_expired') },
    }
    await expect(syncMojoDialIngest({
      now: new Date('2026-11-14T18:00:00.000Z'),
      reader: expired,
      store: db.api,
    })).rejects.toMatchObject({ code: 'session_expired' })
    expect(db.state.saved).toBeNull()
    expect(db.state.batches).toHaveLength(0)
  })

  it('names the missing env vars and does not write when no source is configured', async () => {
    const db = store()
    const error = await syncMojoDialIngest({
      now: new Date('2026-11-14T18:00:00.000Z'),
      sessionId: null,
      env: { NODE_ENV: 'test' } as NodeJS.ProcessEnv,
      store: db.api,
    }).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(MojoDialIngestError)
    expect((error as MojoDialIngestError).code).toBe('credentials_missing')
    expect((error as MojoDialIngestError).missing).toEqual(expect.arrayContaining([
      'MOJO_SESSION_ID',
      'MOJO_MCP_ACCESS_TOKEN',
      'MOJO_MCP_CLIENT_ID',
      'MOJO_MCP_CLIENT_SECRET',
      'MOJO_MCP_REFRESH_TOKEN',
    ]))
    expect(db.state.batches).toHaveLength(0)
  })

  it('does not read or write the Mojo call queue', () => {
    const source = [
      fs.readFileSync('src/lib/server/mojo-dial-ingest.ts', 'utf8'),
      fs.readFileSync('src/app/api/cron/sync-mojo-calls/route.ts', 'utf8'),
      fs.readFileSync('supabase/migrations/20261114180000_mojo_dial_outcome_ingest.sql', 'utf8'),
    ].join('\n')
    expect(source).not.toMatch(/mojo_call_queue/)
  })
})
