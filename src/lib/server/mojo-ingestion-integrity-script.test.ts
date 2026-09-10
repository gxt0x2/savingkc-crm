import expectedRuntime from '@/config/mojo-runtime-manifest.json'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { collectMojoActivities, mojoActivityDayUrl, mojoReplayStartDate, assertMojoReceipts, spoolMojoSource, readMojoSpool } from '../../../scripts/mojo-ingestion-integrity.mjs'
import { indexMojoRecordings } from '../../../scripts/mojo-call-evidence.mjs'
import { stageRuntime, verifyRuntime } from '../../../scripts/mojo-runtime-package.mjs'

const dirs: string[] = []
function temporary() { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mojo-integrity-test-')); dirs.push(dir); return dir }
afterEach(() => { vi.unstubAllGlobals(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }) })
let buildCallRecords: typeof import('../../../scripts/mojo-sync.mjs').buildCallRecords
let deliverMojoCalls: typeof import('../../../scripts/mojo-sync.mjs').deliverMojoCalls
beforeAll(async () => {
  process.env.MOJO_LOG_DIR = os.tmpdir()
  ;({ buildCallRecords, deliverMojoCalls } = await import('../../../scripts/mojo-sync.mjs'))
})
const activity = (id: number, type = 3, details: Record<string, unknown> = {}, date = '09/10/2026 10:00 AM') =>
  [id, type, 'Casey', date, { contact_id: 7, contact_name: 'Test seller', ...details }]
const contact = async () => ({ phone: '9135550123', notes: 'Old unrelated motivation: sell now', address: '', city: '', state: '', zip: '', email: '', followUpDate: '' })

describe('Mojo source integrity', () => {
  it('does not accept HTTP 200 when any record was rejected or receipts are absent', async () => {
    const calls = [{ record_id: 'test-a' }]
    expect(() => assertMojoReceipts(calls, { queued: 0, rejected: 1, total: 1 })).toThrow('checkpoint retained')
    expect(() => assertMojoReceipts(calls, { rejected: 0, total: 1, receipts: [] })).toThrow('checkpoint retained')
    await expect(deliverMojoCalls(calls, async () => new Response(JSON.stringify({ queued: 0, rejected: 1, total: 1 }), { status: 200 })))
      .rejects.toThrow('checkpoint retained')
    expect(() => assertMojoReceipts(calls, { rejected: 0, total: 1, receipts: [{ recordId: 'test-a', status: 'duplicate' }] })).not.toThrow()
  })
  it('reads each explicit provider day including empty days and out-of-order IDs', async () => {
    const fetchDay = vi.fn().mockResolvedValueOnce([activity(9, 3, {}, '09/08/2026 10:00 AM')])
      .mockResolvedValueOnce([]).mockResolvedValueOnce([activity(5)])
    const rows = await collectMojoActivities(fetchDay, { since: '2026-09-08T05:00:00Z', to: '2026-09-10' })
    expect(rows.map(row => row[0])).toEqual([9, 5])
    expect(fetchDay.mock.calls).toEqual([['2026-09-08'], ['2026-09-09'], ['2026-09-10']])
    const url = new URL(mojoActivityDayUrl('https://provider.example', '2026-09-08'))
    expect(url.pathname).toBe('/v2/rest/home/activity-stream/')
    expect(Object.fromEntries(url.searchParams)).toEqual({ start_date: '09/08/2026', end_date: '09/08/2026' })
  })
  it('fails closed on a partial window, ignored date filters, and safety limits', async () => {
    await expect(collectMojoActivities(vi.fn().mockResolvedValueOnce([activity(5)]).mockRejectedValueOnce(new Error('page 2 failed')),
      { since: '2026-09-10T05:00:00Z', to: '2026-09-11' })).rejects.toThrow('page 2 failed')
    await expect(collectMojoActivities(async () => [activity(5)], { since: '2026-09-03T05:00:00Z', to: '2026-09-10' })).rejects.toThrow('ignored activity date filter')
    await expect(collectMojoActivities(async () => [], { since: '2026-09-03T05:00:00Z', to: '2026-09-10', maxDays: 1 })).rejects.toThrow('exceeds')
    await expect(collectMojoActivities(async () => [activity(5)], { since: '2026-09-10T05:00:00Z', to: '2026-09-10', maxRowsPerDay: 1 })).rejects.toThrow('row safety limit')
    await expect(collectMojoActivities(async () => [activity(5), activity(5, 6)], { since: '2026-09-10T05:00:00Z', to: '2026-09-10' })).rejects.toThrow('Conflicting Mojo activity identity')
  })
  it('covers a checkpoint older than the replay window and Central days across DST', async () => {
    expect(mojoReplayStartDate('2026-09-10', '2026-09-01T04:59:00Z')).toBe('2026-08-31')
    expect(mojoReplayStartDate('2026-09-10', '2026-09-10T15:00:00Z')).toBe('2026-09-03')
    const fetchDay = vi.fn().mockResolvedValue([])
    await collectMojoActivities(fetchDay, { since: '2026-10-31T05:00:00Z', to: '2026-11-02' })
    expect(fetchDay.mock.calls).toEqual([['2026-10-31'], ['2026-11-01'], ['2026-11-02']])
    expect(() => mojoActivityDayUrl('https://provider.example', '2026-02-30')).toThrow('Invalid Mojo source date')
    expect(() => mojoReplayStartDate('2026-09-10', 'invalid')).toThrow('Invalid Mojo checkpoint date')
  })
  it('retains the exact source durably across retries and detects corruption', () => {
    const dir = temporary()
    const payload = { activities: [activity(5)], recordings: [{ record_id: 123 }] }
    const first = spoolMojoSource(dir, payload)
    expect(spoolMojoSource(dir, payload).id).toBe(first.id)
    expect(spoolMojoSource(dir, { recordings: payload.recordings, activities: payload.activities }).id).toBe(first.id)
    expect(readMojoSpool(dir)[0].payload).toEqual(payload)
    expect(fs.statSync(first.filename).mode & 0o777).toBe(0o600)
    fs.writeFileSync(first.filename, '{}')
    expect(() => readMojoSpool(dir)).toThrow('checksum')
  })
  it('keeps a callback-only activity and an explicit DNC group without qualifying either as a lead', async () => {
    const callback = await buildCallRecords([activity(5, 6, { datetime: '09/14/2026 12:00 PM' })], 0, 'test', new Map(), '', contact)
    expect(callback.calls).toHaveLength(1)
    expect(callback.calls[0]).toMatchObject({ disposition: 'Callback Requested', follow_up_date: '2026-09-14T17:00:00.000Z', promotion_eligible: false, notes: '' })
    const dnc = await buildCallRecords([activity(6, 11, { group_name: 'Do Not Call' })], 0, 'test', new Map(), '', contact)
    expect(dnc.calls[0]).toMatchObject({ disposition: 'Do Not Call', phone_number: '9135550123', promotion_eligible: false })
  })
  it('retains a batch for retry if contact enrichment fails', async () => {
    await expect(buildCallRecords([activity(5, 6, { datetime: '09/14/2026 12:00 PM' })], 0, 'test', new Map(), '', async () => { throw new Error('lookup failed') }))
      .rejects.toThrow('lookup failed')
  })
  it('keeps separate days and uses the matched recording timestamp for call chronology', async () => {
    const recordings = indexMojoRecordings([{ contact_id: 7, record_id: 10, audio: 'https://example.com/a.mp3', duration_seconds: 180, call_date: '09/10/2026 09:50 AM' }])
    const rows = [activity(5, 3, { contents: 'Motivation: wants to sell' }), activity(4, 3, { contents: 'Timeline: 60 days' }, '09/09/2026 10:00 AM')]
    const result = await buildCallRecords(rows, 0, 'test', recordings, '', contact)
    expect(result.calls).toHaveLength(2)
    expect(result.calls[1]).toMatchObject({ call_date: '2026-09-10T14:50:00.000Z', provider_recording_id: '10' })
    expect(result.calls[0].recording_url).toBe('')
  })
  it('packages transitive dependencies and fails verification when a dependency is missing', () => {
    const dir = temporary()
    const manifest = stageRuntime(process.cwd(), dir)
    // Any runtime code change must update the server's expected component digest.
    expect(manifest.contentDigest).toBe(expectedRuntime.contentDigest)
    expect(manifest.files).toHaveProperty('src/lib/mojo-call-qualification.mjs')
    expect(manifest.files).toHaveProperty('scripts/mojo-call-evidence.mjs')
    expect(verifyRuntime(dir).contentDigest).toBe(manifest.contentDigest)
    fs.unlinkSync(path.join(dir, 'src/lib/mojo-call-qualification.mjs'))
    expect(() => verifyRuntime(dir)).toThrow()
  })
})
