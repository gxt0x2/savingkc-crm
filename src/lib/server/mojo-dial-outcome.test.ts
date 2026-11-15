import fs from 'fs'
import { describe, expect, it } from 'vitest'
import {
  MOJO_DIAL_INGEST_START,
  classifyMojoDialResult,
  dedupeMojoDials,
  mapCallingReportDial,
  mojoCallIngestIsStale,
  mojoDialIngestWindow,
  mojoDialWrite,
} from './mojo-dial-outcome'

const migration = fs.readFileSync('supabase/migrations/20261114180000_mojo_dial_outcome_ingest.sql', 'utf8')

describe('Mojo dial outcome mapping', () => {
  it('maps DNC, take-me-off, wrong number and the live Mojo result labels', () => {
    expect(classifyMojoDialResult('DNC Contact', 5)).toEqual({ outcome: 'dnc', phoneDisposition: 'dnc_contact' })
    expect(classifyMojoDialResult('DNC Number', 6)).toEqual({ outcome: 'dnc', phoneDisposition: 'dnc_number' })
    expect(classifyMojoDialResult('Take me off', null)).toEqual({ outcome: 'dnc', phoneDisposition: 'take_me_off' })
    expect(classifyMojoDialResult('Fax', null)).toEqual({ outcome: 'disconnected', phoneDisposition: 'fax' })
    expect(classifyMojoDialResult('Wrong Number', null)).toEqual({ outcome: 'wrong_number', phoneDisposition: 'wrong_number' })
    expect(classifyMojoDialResult('Bad Number', 3)).toEqual({ outcome: 'disconnected', phoneDisposition: 'bad_number' })
    expect(classifyMojoDialResult('No Contact', 2)).toEqual({ outcome: 'no_answer', phoneDisposition: 'no_answer' })
    expect(classifyMojoDialResult('Answering Machine', 9)).toEqual({ outcome: 'voicemail_left', phoneDisposition: 'left_voicemail' })
    expect(classifyMojoDialResult('Contact', 1)).toEqual({ outcome: 'meaningful_conversation', phoneDisposition: null })
  })

  it('keeps the dialed number off the call ledger and dedupes by Mojo call id', () => {
    const first = mapCallingReportDial({
      id: 42,
      contact: { id: 7, full_name: 'Pat Example' },
      phone_number: '(816) 555-0142',
      result: 'Wrong Number',
      create_date: '2026-10-28T15:00:00-05:00',
      session: { id: 9 },
      agent_name: 'Casey',
      notes: ['secret note'],
    }, 0)
    const longer = mapCallingReportDial({
      id: 42,
      contact: { id: 7 },
      phone_number: '8165550142',
      result: 'Wrong Number',
      create_date: '2026-10-28T15:00:00-05:00',
      session: { id: 9 },
      is_recorded: true,
    }, 30)
    const kept = dedupeMojoDials([first, longer])
    expect(kept).toHaveLength(1)
    expect(kept[0]?.fact.duration_seconds).toBe(30)
    expect(JSON.stringify(kept[0]?.fact)).not.toContain('5550142')
    expect(JSON.stringify(kept[0]?.fact)).not.toContain('Pat Example')
    const write = mojoDialWrite(kept[0]!)
    expect(write.provider_call_id).toBe('42')
    expect(write.record_id).toBe('mojo-call-42')
    expect(write.phone_last4).toBe('0142')
    expect(write.normalized_phone).toBe('+18165550142')
    expect(write.phone_disposition).toBe('wrong_number')
    expect(write.outcome).toBe('wrong_number')
  })
})

describe('Mojo dial ingest window and staleness', () => {
  it('backfills one day at a time from 2026-10-28, then refreshes yesterday and today', () => {
    expect(mojoDialIngestWindow({ cursor: null, today: '2026-11-14' })).toEqual({
      from: MOJO_DIAL_INGEST_START,
      to: MOJO_DIAL_INGEST_START,
      catchingUp: true,
      nextCursor: '2026-10-29',
    })
    expect(mojoDialIngestWindow({ cursor: '2026-11-13', today: '2026-11-14' }).nextCursor).toBe('2026-11-14')
    expect(mojoDialIngestWindow({ cursor: '2026-11-14', today: '2026-11-14' })).toMatchObject({
      from: '2026-11-13',
      to: '2026-11-14',
      catchingUp: false,
      nextCursor: '2026-11-14',
    })
  })

  it('lets an explicit two-day replay continue the cursor and rejects a wider window', () => {
    expect(mojoDialIngestWindow({
      cursor: '2026-10-28',
      today: '2026-11-14',
      from: '2026-10-28',
      to: '2026-10-29',
    }).nextCursor).toBe('2026-10-30')
    expect(mojoDialIngestWindow({
      cursor: '2026-10-28',
      today: '2026-11-14',
      from: '2026-11-01',
      to: '2026-11-01',
    }).nextCursor).toBe('2026-10-28')
    expect(() => mojoDialIngestWindow({
      cursor: null,
      today: '2026-11-14',
      from: '2026-10-28',
      to: '2026-10-31',
    })).toThrow('mojo_dial_window_too_wide')
  })

  it('treats ingest as stale only after more than 24 hours', () => {
    const now = new Date('2026-11-14T18:00:00.000Z')
    expect(mojoCallIngestIsStale(null, now)).toBe(true)
    expect(mojoCallIngestIsStale('2026-11-13T18:00:00.000Z', now)).toBe(false)
    expect(mojoCallIngestIsStale('2026-11-13T17:59:59.000Z', now)).toBe(true)
  })
})

describe('Mojo dial outcome migration', () => {
  it('is additive, idempotent, and never clears an opt-out or touches the call queue', () => {
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.apply_mojo_dial_batch_v1')
    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.apply_mojo_dial_phone_stamp_v1')
    expect(migration).toContain('public.upsert_crm_mojo_call_v1(fact)')
    expect(migration).toContain('ON CONFLICT (record_id) DO NOTHING')
    expect(migration).toContain('inserted_id := NULL')
    expect(migration).toContain('attempted = true')
    expect(migration).toContain("WHEN p_disposition = 'dnc' THEN true ELSE phone.voice_hold")
    expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.apply_mojo_dial_batch_v1(jsonb)')
    expect(migration).toContain('TO service_role')
    expect(migration).not.toMatch(/\bmojo_call_queue\b/)
    expect(migration).not.toMatch(/\bsms_opt_outs\b/)
    expect(migration).not.toMatch(/\bDELETE\b/)
    expect(migration).not.toMatch(/\bTRUNCATE\b/)
    expect(migration).not.toMatch(/voice_hold\s*=\s*false/)
    expect(migration).not.toMatch(/attempted\s*=\s*false/)
  })
})
