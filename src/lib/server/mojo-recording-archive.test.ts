import { beforeEach, describe, expect, it, vi } from 'vitest'

import { archiveCanonicalMojoRecording, archivePendingMojoRecordings } from './mojo-recording-archive'
import type { MojoCallIngestResult, MojoCallRecord } from './mojo-call-import'

const EVENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const result: MojoCallIngestResult = {
  eventId: EVENT_ID,
  leadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  activityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  outcome: 'meaningful_conversation',
  normalizedPhone: '+19135550123',
  unresolvedReason: null,
  callAt: '2026-08-28T13:00:00.000Z',
  followUpAt: null,
  station: 'contacted',
  assignedAgent: 'Casey',
  latestForLead: true,
  replayed: false,
}

const call: MojoCallRecord = {
  record_id: 'mojo-recording-123',
  contact_name: 'Seller Example',
  phone_number: '9135550123',
  property_address: '',
  city: '',
  state: 'MO',
  zip: '',
  call_date: result.callAt,
  call_duration: 91,
  disposition: 'Interested',
  agent_name: 'Casey',
  recording_url: 'https://app71.mojosells.com/v2/rest/reports/call-recording-get-audio/?record_id=123',
}

describe('canonical Mojo recording archive', () => {
  const single = vi.fn()
  const upload = vi.fn()
  const rpc = vi.fn()
  const download = vi.fn()
  const read = vi.fn()
  const remove = vi.fn()
  const backlogLimit = vi.fn()
  const backlogOrder = vi.fn(() => ({ limit: backlogLimit }))
  const backlogIs = vi.fn(() => ({ order: backlogOrder }))
  const secondNot = vi.fn(() => ({ is: backlogIs }))
  const firstNot = vi.fn(() => ({ not: secondNot }))
  const db = {
    from: () => ({
      select: () => ({
        eq: () => ({ single }),
        not: firstNot,
      }),
    }),
    storage: { from: () => ({ upload }) },
    rpc,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    single.mockResolvedValue({ data: { recording_storage_path: null }, error: null })
    upload.mockResolvedValue({ error: null })
    rpc.mockResolvedValue({ error: null })
    download.mockResolvedValue('/tmp/mojo-recording.mp3')
    read.mockResolvedValue(Buffer.alloc(2_048, 7))
    remove.mockResolvedValue(undefined)
    backlogLimit.mockResolvedValue({ data: [], error: null })
  })

  it('uploads once, commits verified metadata, and removes the temporary file', async () => {
    await expect(archiveCanonicalMojoRecording(result, call, {
      db: db as never,
      download,
      read: read as never,
      remove: remove as never,
    })).resolves.toBe(`/api/recordings/mojo/${EVENT_ID}`)

    expect(upload).toHaveBeenCalledWith(
      `mojo/${EVENT_ID}.mp3`,
      expect.any(Buffer),
      { contentType: 'audio/mpeg', upsert: true },
    )
    expect(rpc).toHaveBeenCalledWith('archive_crm_mojo_recording_v1', expect.objectContaining({
      p_event_id: EVENT_ID,
      p_storage_path: `mojo/${EVENT_ID}.mp3`,
      p_byte_size: 2_048,
      p_sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
    }))
    expect(remove).toHaveBeenCalledWith('/tmp/mojo-recording.mp3')
  })

  it('does not download an event that is already archived', async () => {
    single.mockResolvedValue({ data: { recording_storage_path: `mojo/${EVENT_ID}.mp3` }, error: null })

    await expect(archiveCanonicalMojoRecording(result, call, { db: db as never, download }))
      .resolves.toBe(`/api/recordings/mojo/${EVENT_ID}`)

    expect(download).not.toHaveBeenCalled()
    expect(upload).not.toHaveBeenCalled()
  })

  it('does not archive legacy activity-derived recording matches', async () => {
    await expect(archiveCanonicalMojoRecording(result, {
      ...call,
      record_id: 'mojo-activity-123-456',
    }, { db: db as never, download })).resolves.toBeNull()

    expect(single).not.toHaveBeenCalled()
    expect(download).not.toHaveBeenCalled()
  })

  it('rejects invalid audio and still removes the temporary file', async () => {
    read.mockResolvedValue(Buffer.alloc(100))

    await expect(archiveCanonicalMojoRecording(result, call, {
      db: db as never,
      download,
      read: read as never,
      remove: remove as never,
    })).rejects.toThrow('empty or invalid')

    expect(upload).not.toHaveBeenCalled()
    expect(remove).toHaveBeenCalledWith('/tmp/mojo-recording.mp3')
  })

  it('archives a bounded backlog using the same idempotent path', async () => {
    backlogLimit.mockResolvedValue({
      data: [{ id: EVENT_ID, record_id: call.record_id, recording_url: call.recording_url }],
      error: null,
    })

    await expect(archivePendingMojoRecordings(50, {
      db: db as never,
      download,
      read: read as never,
      remove: remove as never,
    })).resolves.toEqual({ inspected: 1, archived: 1, failed: 0 })

    expect(backlogLimit).toHaveBeenCalledWith(5)
    expect(firstNot).toHaveBeenCalledWith('recording_url', 'is', null)
    expect(secondNot).toHaveBeenCalledWith('record_id', 'like', 'mojo-activity-%')
    expect(upload).toHaveBeenCalledOnce()
  })
})
