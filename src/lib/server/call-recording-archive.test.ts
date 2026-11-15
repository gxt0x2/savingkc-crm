import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { archivedActivityMetadata, twilioRecordingDownloadUrl } from '@/lib/marketing/recording-playback'
import {
  applyRecordingPage,
  archiveOne,
  attachMojoCallRecordingUrls,
  oldestExpiringFirst,
  omitTwilioCallsAlreadyAttempted,
  planRecordingBackfill,
  twilioArchiveSelection,
  readAllPages,
  readBoundedAudio,
  recordingSourceReady,
  type RecordingArchiveTarget,
} from './call-recording-archive'

const eventStored = '11111111-1111-4111-8111-111111111111'
const eventOld = '22222222-2222-4222-8222-222222222222'
const eventNew = '33333333-3333-4333-8333-333333333333'
const callReady = '44444444-4444-4444-8444-444444444444'
const callWaiting = '55555555-5555-4555-8555-555555555555'
const attemptLead = '66666666-6666-4666-8666-666666666666'
const attemptBare = '77777777-7777-4777-8777-777777777777'
const attemptStored = '88888888-8888-4888-8888-888888888888'
const leadId = '99999999-9999-4999-8999-999999999999'
const sidLead = `RE${'a'.repeat(32)}`
const sidBare = `RE${'b'.repeat(32)}`
const sidStored = `RE${'c'.repeat(32)}`
const callOnly = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'
const callSidOnly = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2'
const whisperOnly = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4'
const lowerSid = `RE${'a'.repeat(32)}`

function row(partial: RecordingArchiveTarget): RecordingArchiveTarget {
  return partial
}

const fixture: RecordingArchiveTarget[] = [
  row({ kind: 'mojo_event', id: eventStored, recordedAt: '2026-07-01T00:00:00.000Z', leadId, recordingUrl: 'https://app71.mojosells.com/stored.mp3', recordingSid: null, storagePath: `events/${eventStored}.mp3` }),
  row({ kind: 'mojo_event', id: eventOld, recordedAt: '2026-08-01T00:00:00.000Z', leadId, recordingUrl: 'https://app71.mojosells.com/old.mp3', recordingSid: null, storagePath: null }),
  row({ kind: 'mojo_event', id: eventNew, recordedAt: '2026-09-01T00:00:00.000Z', leadId, recordingUrl: 'https://app71.mojosells.com/new.mp3', recordingSid: null, storagePath: null }),
  row({ kind: 'mojo_call', id: callReady, recordedAt: '2026-08-15T00:00:00.000Z', leadId, recordingUrl: 'https://app71.mojosells.com/call.mp3', recordingSid: null, storagePath: null, isRecorded: true, providerCallId: '400' }),
  row({ kind: 'mojo_call', id: callWaiting, recordedAt: '2026-08-16T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: null, storagePath: null, isRecorded: true, providerCallId: '401' }),
  row({ kind: 'twilio_attempt', id: attemptLead, recordedAt: '2026-08-25T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: sidLead, storagePath: null }),
  row({ kind: 'twilio_attempt', id: attemptBare, recordedAt: '2026-09-02T00:00:00.000Z', leadId: null, recordingUrl: null, recordingSid: sidBare, storagePath: null }),
  row({ kind: 'twilio_attempt', id: attemptStored, recordedAt: '2026-03-27T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: sidStored, storagePath: `leads/${leadId}/twilio_${sidStored}.mp3` }),
  row({ kind: 'twilio_call', id: callOnly, recordedAt: '2026-10-01T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: `RE${'d'.repeat(32)}`, callSid: `CA${'d'.repeat(32)}`, storagePath: null }),
  row({ kind: 'twilio_call', id: callSidOnly, recordedAt: '2026-10-02T00:00:00.000Z', leadId: null, recordingUrl: null, recordingSid: null, callSid: `CA${'e'.repeat(32)}`, storagePath: null }),
  row({ kind: 'twilio_note', id: whisperOnly, recordedAt: '2026-10-03T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: `RE${'9'.repeat(32)}`, storagePath: null }),
]

const migration = readFileSync('supabase/migrations/20261217120000_call_recording_archive.sql', 'utf8')
const archiveSource = readFileSync('src/lib/server/call-recording-archive.ts', 'utf8')

describe('call recording archive', () => {
  it('dry-runs the local fixture without downloading', () => {
    const downloadMojo = vi.fn()
    const downloadTwilio = vi.fn()
    const plan = planRecordingBackfill(fixture, { limit: 5 })
    expect(downloadMojo).not.toHaveBeenCalled()
    expect(downloadTwilio).not.toHaveBeenCalled()
    expect(plan.dryRun).toBe(true)
    expect(plan.archived).toBe(0)
    expect(plan.wouldArchive).toEqual({ mojoEvents: 2, mojoCalls: 1, twilioAttempts: 2, twilioCalls: 2, whisperNotes: 1, total: 8 })
    expect(plan.alreadyStored).toEqual({ mojoEvents: 1, mojoCalls: 0, twilioAttempts: 1, twilioCalls: 0, whisperNotes: 0, total: 2 })
    const archivedSids = planRecordingBackfill(fixture, { limit: 20 }).page
      .map((item) => item.recordingSid)
      .filter((sid): sid is string => Boolean(sid))
    expect(new Set(archivedSids).size).toBe(archivedSids.length)
    expect(plan.mojoCallsAwaitingUrl).toBe(1)
    expect(plan.page.map((item) => item.id)).toEqual([eventOld, callReady, attemptLead, eventNew, attemptBare])
    expect(oldestExpiringFirst(plan.page).map((item) => item.recordedAt)).toEqual([
      '2026-08-01T00:00:00.000Z',
      '2026-08-15T00:00:00.000Z',
      '2026-08-25T00:00:00.000Z',
      '2026-09-01T00:00:00.000Z',
      '2026-09-02T00:00:00.000Z',
    ])
  })

  it('pages the dry-run oldest first so a later call can resume', () => {
    const first = planRecordingBackfill(fixture, { limit: 2 })
    const second = planRecordingBackfill(fixture, { cursor: first.nextCursor, limit: 2 })
    expect(first.page.map((item) => item.id)).toEqual([eventOld, callReady])
    expect(second.page.map((item) => item.id)).toEqual([attemptLead, eventNew])
    expect(second.wouldArchive.total).toBe(8)
  })

  it('copies a recording once and skips the download when the path is already stored', async () => {
    const target = fixture.find((item) => item.id === eventOld)
    if (!target) throw new Error('missing fixture')
    const pending = { ...target, storagePath: null }
    const downloadMojo = vi.fn(async () => new Uint8Array(1200))
    const upload = vi.fn(async () => undefined)
    const markStored = vi.fn(async (row: RecordingArchiveTarget, path: string) => {
      row.storagePath = path
    })
    const deps = {
      downloadMojo,
      downloadTwilio: vi.fn(),
      upload,
      markStored,
      now: () => new Date('2026-11-15T00:00:00.000Z'),
    }
    await expect(archiveOne(pending, deps)).resolves.toBe('archived')
    expect(downloadMojo).toHaveBeenCalledTimes(1)
    expect(upload).toHaveBeenCalledWith('mojo-call-recordings', `events/${eventOld}.mp3`, expect.any(Uint8Array))
    await expect(archiveOne(pending, deps)).resolves.toBe('already_stored')
    expect(downloadMojo).toHaveBeenCalledTimes(1)
    expect(recordingSourceReady({ ...pending, storagePath: null, recordingUrl: 'https://evil.example/a.mp3' })).toBe(false)
  })

  it('rate-limits an apply page and does not archive a call that has no recording url yet', async () => {
    const sleep = vi.fn(async () => undefined)
    const downloadTwilio = vi.fn(async () => new Uint8Array(1500))
    const applied = await applyRecordingPage(
      [fixture.find((item) => item.id === attemptLead)!, fixture.find((item) => item.id === attemptBare)!],
      {
        downloadMojo: vi.fn(),
        downloadTwilio,
        upload: vi.fn(async () => undefined),
        markStored: vi.fn(async () => undefined),
        sleep,
        now: () => new Date('2026-11-15T00:00:00.000Z'),
      },
      1000,
    )
    expect(applied.archived).toBe(2)
    expect(sleep).toHaveBeenCalledTimes(1)
    expect(sleep).toHaveBeenCalledWith(1000)
    expect(downloadTwilio).toHaveBeenCalledTimes(2)
    const waiting = fixture.find((item) => item.id === callWaiting)
    expect(waiting && recordingSourceReady(waiting)).toBe(false)
  })

  it('archives a recorded mojo call once its report url is attached, including calls that were not promotion eligible', () => {
    const waiting = { ...fixture.find((item) => item.id === callWaiting)! }
    expect(attachMojoCallRecordingUrls([waiting], [{
      call_id: 401,
      audio: 'https://app71.mojosells.com/waiting.mp3',
    }])).toBe(1)
    expect(recordingSourceReady(waiting)).toBe(true)
    const plan = planRecordingBackfill([waiting, fixture.find((item) => item.id === eventOld)!])
    expect(plan.wouldArchive).toMatchObject({ mojoEvents: 1, mojoCalls: 1, total: 2 })
    expect(plan.mojoCallsAwaitingUrl).toBe(0)
  })

  it('adds only nullable archive columns and leaves export functions alone', () => {
    expect('20261217120000' > '20261216120000').toBe(true)
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS recording_url text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS recording_storage_path text')
    expect(migration).toContain('ADD COLUMN IF NOT EXISTS recording_copied_at timestamptz')
    expect(migration).toContain("recording_url ~ '^[^[:space:]]+$'")
    expect(migration).toContain('char_length(recording_url) <= 1800')
    expect(migration).not.toContain('{1,1800}')
    expect(migration).toContain("'%2F'")
    expect(migration).toContain('ON CONFLICT (id) DO NOTHING')
    expect(migration).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i)
    expect(migration).not.toMatch(/dialer_export|source_list|mojo_call_queue/i)
    expect(archiveSource).not.toMatch(/claimMojoCallQueue|finishMojoCallQueue|mojo_call_queue/)
    expect(archiveSource).not.toContain('20261216120000')
  })

  it('matches a lowercase-hex SID to its attempt and leaves the stored SID unchanged', async () => {
    const attempt = row({ kind: 'twilio_attempt', id: attemptLead, recordedAt: '2026-08-25T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: lowerSid, storagePath: null })
    const call = row({ kind: 'twilio_call', id: callOnly, recordedAt: '2026-08-26T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: `re${'A'.repeat(32)}`, storagePath: null })
    const selected = twilioArchiveSelection({ attempts: [attempt], calls: [call], notes: [] })
    expect(selected.calls).toEqual([])
    const plan = planRecordingBackfill([attempt, ...selected.calls])
    expect(plan.wouldArchive).toMatchObject({ twilioAttempts: 1, twilioCalls: 0, total: 1 })
    const downloadTwilio = vi.fn(async () => new Uint8Array(1200))
    const applied = await applyRecordingPage(plan.page, {
      downloadMojo: vi.fn(),
      downloadTwilio,
      upload: vi.fn(async () => undefined),
      markStored: vi.fn(async () => undefined),
      sleep: vi.fn(async () => undefined),
      now: () => new Date('2026-11-15T00:00:00.000Z'),
    }, 0)
    expect(applied.archived).toBe(1)
    expect(downloadTwilio).toHaveBeenCalledTimes(1)
    expect(downloadTwilio).toHaveBeenCalledWith(lowerSid)
    const account = `AC${'1'.repeat(32)}`
    expect(twilioRecordingDownloadUrl(account, lowerSid)).toBe(`https://api.twilio.com/2010-04-01/Accounts/${account}/Recordings/${lowerSid}.mp3`)
    expect(twilioRecordingDownloadUrl(account, `RE${'A'.repeat(32)}`)).toBe(`https://api.twilio.com/2010-04-01/Accounts/${account}/Recordings/RE${'a'.repeat(32)}.mp3`)
    const metadata = { recordingSid: lowerSid, source: 'twilio_recording_callback' }
    expect(archivedActivityMetadata(metadata, `leads/${leadId}/twilio_${lowerSid}.mp3`, '2026-11-15T00:00:00.000Z')).toMatchObject({
      recordingSid: lowerSid,
      recording_storage_path: `leads/${leadId}/twilio_${lowerSid}.mp3`,
    })
  })

  it('archives a whisper note once and skips it when the same SID is already on an attempt or a call', () => {
    const sid = `RE${'9'.repeat(32)}`
    const note = row({ kind: 'twilio_note', id: whisperOnly, recordedAt: '2026-04-20T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: sid, storagePath: null })
    const duplicate = row({ kind: 'twilio_note', id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5', recordedAt: '2026-04-21T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: sid, storagePath: null })
    expect(twilioArchiveSelection({ attempts: [], calls: [], notes: [note, duplicate] }).notes.map((item) => item.id)).toEqual([whisperOnly])
    const attempt = row({ kind: 'twilio_attempt', id: attemptLead, recordedAt: '2026-04-22T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: sid, storagePath: null })
    const call = row({ kind: 'twilio_call', id: callOnly, recordedAt: '2026-04-23T00:00:00.000Z', leadId, recordingUrl: null, recordingSid: sid, storagePath: null })
    expect(twilioArchiveSelection({ attempts: [attempt], calls: [], notes: [note] }).notes).toEqual([])
    expect(twilioArchiveSelection({ attempts: [], calls: [call], notes: [note] }).notes).toEqual([])
    expect(planRecordingBackfill([note]).wouldArchive).toMatchObject({ whisperNotes: 1, total: 1 })
  })

  it('covers a Twilio recording that has no dialer attempt, and skips one the attempt already owns', () => {
    const owned = fixture.find((item) => item.id === attemptLead)!
    const duplicate = row({
      kind: 'twilio_call',
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
      recordedAt: '2026-08-20T00:00:00.000Z',
      leadId,
      recordingUrl: null,
      recordingSid: owned.recordingSid,
      callSid: `CA${'a'.repeat(32)}`,
      storagePath: null,
    })
    const uncovered = fixture.filter((item) => item.kind === 'twilio_call')
    const kept = omitTwilioCallsAlreadyAttempted([...uncovered, duplicate], [owned])
    expect(kept.map((item) => item.id)).toEqual([callOnly, callSidOnly])
    expect(planRecordingBackfill(kept).wouldArchive.twilioCalls).toBe(2)
  })

  it('pages past 1000 unstored rows and refuses an oversized recording before reading it', async () => {
    const readPage = vi.fn(async (offset: number, limit: number) => {
      if (offset === 0) return Array.from({ length: limit }, (_, index) => index)
      if (offset === limit) return [limit]
      return []
    })
    await expect(readAllPages(readPage, 1000)).resolves.toHaveLength(1001)
    const body = { cancel: vi.fn(async () => undefined), getReader: vi.fn() }
    const oversized = { headers: { get: (name: string) => name === 'content-length' ? '200000000' : null }, body }
    await expect(readBoundedAudio(oversized as never)).rejects.toThrow('recording_bytes_rejected')
    expect(body.getReader).not.toHaveBeenCalled()
    expect(body.cancel).toHaveBeenCalled()
  })
})
