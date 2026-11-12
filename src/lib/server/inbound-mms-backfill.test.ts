import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  backfillInboundMmsActivities,
  inboundMmsBackfillSince,
  isHistoricalInboundMms,
  loadInboundMmsBackfillRows,
  type InboundMmsBackfillDb,
  type InboundMmsBackfillRow,
} from './inbound-mms-backfill'

const SID = `MM${'a'.repeat(32)}`
const MEDIA_SID = `ME${'c'.repeat(32)}`
const ACCOUNT_SID = `AC${'b'.repeat(32)}`
const SANDBOX = '+19137179716'

function row(metadata: Record<string, unknown>, description = ''): InboundMmsBackfillRow {
  return { id: 'activity-mms', description, metadata, activity_type: 'sms', created_at: '2026-11-11T22:06:33.317Z' }
}

function mediaList() {
  return new Response(JSON.stringify({
    media_list: [{ sid: MEDIA_SID, content_type: 'image/jpeg', uri: 'https://evil.example/photo' }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('historical inbound MMS backfill', () => {
  it('stores an empty MM receipt the same way a new inbound MMS is stored', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', ACCOUNT_SID)
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
    const bytes = Uint8Array.from([9, 8, 7, 6])
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/Media.json')) return mediaList()
      return new Response(bytes, { status: 200, headers: { 'content-type': 'image/jpeg' } })
    })
    const upload = vi.fn(async () => undefined)
    const saved: Array<{ description: string; metadata: Record<string, unknown> }> = []
    const save = vi.fn(async (_row: InboundMmsBackfillRow, patch: { description: string; metadata: Record<string, unknown> }) => {
      saved.push(patch)
    })
    const original = row({
      direction: 'received',
      from: SANDBOX,
      to: '+18166088588',
      message_sid: SID,
      source: 'twilio_sms_webhook',
    })
    const storedMetadata = {
      direction: 'received',
      from: SANDBOX,
      to: '+18166088588',
      message_sid: SID,
      source: 'twilio_sms_webhook',
      num_media: 1,
      mms: [{
        index: 0,
        storage_bucket: 'inbound-mms',
        storage_path: `${SID}/0-mms-0.jpg`,
        content_type: 'image/jpeg',
        byte_size: 4,
      }],
    }

    const report = await backfillInboundMmsActivities({
      rows: [original],
      apply: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      upload,
      save,
    })

    expect(report).toMatchObject({ stored: 1, storedSids: [SID], notFound: [], failed: [] })
    expect(upload).toHaveBeenCalledWith(`${SID}/0-mms-0.jpg`, bytes, 'image/jpeg')
    expect(saved).toEqual([{ description: 'Sent a photo', metadata: storedMetadata }])
    expect(JSON.stringify(saved)).not.toMatch(/twilio\.com|evil\.example|test-token/)

    const stored = row(storedMetadata, 'Sent a photo')
    fetchImpl.mockClear()
    const again = await backfillInboundMmsActivities({
      rows: [stored],
      apply: true,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      upload,
      save,
    })
    expect(again.alreadyStored).toBe(1)
    expect(again.stored).toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('reports a Twilio 404 and does not write an empty media list', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', ACCOUNT_SID)
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
    const missing = vi.fn(async () => new Response('missing', { status: 404 }))
    const save = vi.fn(async () => undefined)
    const upload = vi.fn(async () => undefined)
    const report = await backfillInboundMmsActivities({
      rows: [row({ direction: 'received', message_sid: SID, from: SANDBOX })],
      apply: true,
      fetchImpl: missing as unknown as typeof fetch,
      upload,
      save,
    })
    expect(report.notFound).toEqual([{ activityId: 'activity-mms', messageSid: SID, status: 404 }])
    expect(upload).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()

    const empty = vi.fn(async () => new Response(JSON.stringify({ media_list: [] }), { status: 200 }))
    const emptyReport = await backfillInboundMmsActivities({
      rows: [row({ direction: 'received', message_sid: SID, from: SANDBOX })],
      apply: true,
      fetchImpl: empty as unknown as typeof fetch,
      upload,
      save,
    })
    expect(emptyReport.empty).toEqual([{ activityId: 'activity-mms', messageSid: SID }])
    expect(save).not.toHaveBeenCalled()

    const gone = vi.fn(async (url: string) => url.includes('/Media.json')
      ? mediaList()
      : new Response('gone', { status: 404 }))
    const downloadReport = await backfillInboundMmsActivities({
      rows: [row({ direction: 'received', message_sid: SID, from: SANDBOX })],
      apply: true,
      fetchImpl: gone as unknown as typeof fetch,
      upload,
      save,
    })
    expect(downloadReport.notFound).toEqual([{ activityId: 'activity-mms', messageSid: SID, status: 404 }])
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps a text body and skips internal alert copies', () => {
    expect(isHistoricalInboundMms({ direction: 'received', message_sid: SID, from: SANDBOX })).toBe(true)
    expect(isHistoricalInboundMms({ direction: 'received', message_sid: `SM${'a'.repeat(32)}` })).toBe(false)
    expect(isHistoricalInboundMms({ direction: 'received', message_sid: SID, team_member: 'Ernest' })).toBe(false)
    expect(isHistoricalInboundMms({
      direction: 'received',
      message_sid: SID,
      mms: [{ storage_bucket: 'inbound-mms', storage_path: `${SID}/0-mms-0.jpg`, content_type: 'image/jpeg' }],
    })).toBe(false)
    expect(inboundMmsBackfillSince(30, Date.parse('2026-11-11T22:06:33.317Z'))).toBe('2026-10-12T22:06:33.317Z')
  })

  it('previews the last 30 days without downloading or writing', async () => {
    vi.stubEnv('TWILIO_ACCOUNT_SID', ACCOUNT_SID)
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'test-token')
    const calls: string[] = []
    const query = {
      select: (columns: string) => { calls.push(`select ${columns}`); return query },
      eq: (column: string, value: string) => { calls.push(`eq ${column} ${value}`); return query },
      in: (column: string, values: string[]) => { calls.push(`in ${column} ${values.join('|')}`); return query },
      gte: (column: string, value: string) => { calls.push(`gte ${column} ${value}`); return query },
      like: (column: string, value: string) => { calls.push(`like ${column} ${value}`); return query },
      order: () => query,
      range: async () => ({
        data: [
          row({ direction: 'received', message_sid: SID, from: SANDBOX }),
          row({ direction: 'received', message_sid: SID, team_member: 'Ernest' }),
        ],
        error: null,
      }),
    }
    const db = { from: () => query } as unknown as InboundMmsBackfillDb
    const rows = await loadInboundMmsBackfillRows(db, { since: '2026-10-12T00:00:00.000Z', limit: 100 })
    expect(rows).toHaveLength(1)
    expect(calls).toContain('eq activity_type sms')
    expect(calls).toContain('like metadata->>message_sid MM%')
    expect(calls.some((call) => call.startsWith('gte created_at'))).toBe(true)

    const fetchImpl = vi.fn(async (url: string) => {
      expect(url).toContain('/Media.json')
      return mediaList()
    })
    const upload = vi.fn(async () => undefined)
    const save = vi.fn(async () => undefined)
    const report = await backfillInboundMmsActivities({
      rows,
      apply: false,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      upload,
      save,
    })
    expect(report).toMatchObject({ pending: 1, stored: 0 })
    expect(upload).not.toHaveBeenCalled()
    expect(save).not.toHaveBeenCalled()
  })
})
