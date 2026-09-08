import { describe, expect, it, vi } from 'vitest'
import {
  mapMojoDisposition,
  normalizeMojoCallRecord,
  processCanonicalMojoCall,
  runCanonicalMojoQueueWorker,
  type MojoCallIngestResult,
  type MojoCallRecord,
} from './mojo-call-import'

const call: MojoCallRecord = {
  record_id: 'mojo-123',
  contact_name: 'Seller Example',
  phone_number: '(913) 555-0123',
  property_address: '123 Main St',
  city: 'Kansas City',
  state: 'mo',
  zip: '64111',
  call_date: '2026-08-24T12:00:00Z',
  call_duration: 120,
  disposition: 'Callback requested',
  agent_name: 'Casey',
  notes: 'Seller asked for a callback.',
  follow_up_date: '2026-08-25T15:00:00Z',
}

function result(overrides: Partial<MojoCallIngestResult> = {}): MojoCallIngestResult {
  return {
    eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    leadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    activityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    outcome: 'callback_scheduled',
    normalizedPhone: '+19135550123',
    unresolvedReason: null,
    callAt: call.call_date,
    followUpAt: call.follow_up_date || null,
    station: 'new',
    assignedAgent: 'Casey',
    latestForLead: true,
    replayed: false,
    ...overrides,
  }
}

describe('canonical Mojo call import', () => {
  it('normalizes provider facts without inventing CRM intelligence', () => {
    expect(normalizeMojoCallRecord({ ...call, call_duration: 120.8 })).toMatchObject({
      record_id: 'mojo-123',
      state: 'MO',
      call_duration: 120,
      call_date: '2026-08-24T12:00:00.000Z',
      follow_up_date: '2026-08-25T15:00:00.000Z',
    })
    expect(() => normalizeMojoCallRecord({ ...call, record_id: '' })).toThrow('invalid_record_id')
    expect(() => normalizeMojoCallRecord({ ...call, call_date: 'not-a-date' })).toThrow('invalid_call_date')
    expect(() => normalizeMojoCallRecord({ ...call, recording_url: 'http://127.0.0.1/private' })).toThrow('invalid_recording_url')
  })

  it.each([
    ['Appointment Set', 'appointment_set'],
    ['Motivated seller', 'meaningful_conversation'],
    ['Wrong Number', 'wrong_number'],
    ['Do Not Call', 'dnc'],
    ['Already sold', 'already_sold'],
    ['No answer', 'no_answer'],
  ] as const)('maps the human/provider disposition %s to %s', (disposition, outcome) => {
    expect(mapMojoDisposition(disposition)).toBe(outcome)
  })

  it('creates only the event-backed callback and governed lifecycle command', async () => {
    const dependencies = {
      ingest: vi.fn().mockResolvedValue(result()),
      suppressDnc: vi.fn(),
      createAppointment: vi.fn(),
      createFollowUp: vi.fn(),
      transitionLifecycle: vi.fn(),
      archiveRecording: vi.fn(),
    }
    await expect(processCanonicalMojoCall(call, dependencies)).resolves.toMatchObject({
      outcome: 'callback_scheduled',
      leadId: result().leadId,
    })
    expect(dependencies.createFollowUp).toHaveBeenCalledOnce()
    expect(dependencies.createAppointment).not.toHaveBeenCalled()
    expect(dependencies.suppressDnc).not.toHaveBeenCalled()
    expect(dependencies.transitionLifecycle).toHaveBeenCalledOnce()
  })

  it('persists DNC suppression even when the provider event cannot resolve a lead', async () => {
    const dnc = result({ leadId: null, activityId: null, outcome: 'dnc', unresolvedReason: 'unknown_contact' })
    const dependencies = {
      ingest: vi.fn().mockResolvedValue(dnc),
      suppressDnc: vi.fn().mockResolvedValue(undefined),
      createAppointment: vi.fn(),
      createFollowUp: vi.fn(),
      transitionLifecycle: vi.fn(),
      archiveRecording: vi.fn(),
    }
    await processCanonicalMojoCall({ ...call, disposition: 'DNC request' }, dependencies)
    expect(dependencies.suppressDnc).toHaveBeenCalledWith('+19135550123')
    expect(dependencies.transitionLifecycle).not.toHaveBeenCalled()
  })

  it('archives a provider recording after canonical call effects complete', async () => {
    const dependencies = {
      ingest: vi.fn().mockResolvedValue(result()),
      suppressDnc: vi.fn(),
      createAppointment: vi.fn(),
      createFollowUp: vi.fn(),
      transitionLifecycle: vi.fn().mockResolvedValue(undefined),
      archiveRecording: vi.fn().mockResolvedValue('/api/recordings/mojo/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    }
    const recordedCall = {
      ...call,
      recording_url: 'https://app71.mojosells.com/v2/rest/reports/call-recording-get-audio/?record_id=123',
    }

    await processCanonicalMojoCall(recordedCall, dependencies)

    expect(dependencies.transitionLifecycle).toHaveBeenCalledOnce()
    expect(dependencies.archiveRecording).toHaveBeenCalledWith(result(), expect.objectContaining({
      record_id: 'mojo-123',
      recording_url: recordedCall.recording_url,
    }))
  })

  it('finishes successes and durably releases failures for retry', async () => {
    const claims = [
      { id: 'queue-1', recordId: 'good', call: { ...call, record_id: 'good' }, attempts: 1 },
      { id: 'queue-2', recordId: 'bad', call: { ...call, record_id: 'bad' }, attempts: 1 },
    ]
    const finish = vi.fn()
      .mockResolvedValueOnce('completed')
      .mockResolvedValueOnce('pending')
    const worker = await runCanonicalMojoQueueWorker({
      claim: vi.fn().mockResolvedValue(claims),
      process: vi.fn()
        .mockResolvedValueOnce(result())
        .mockRejectedValueOnce(new Error('temporary failure')),
      finish,
      archiveBacklog: vi.fn().mockResolvedValue({ inspected: 2, archived: 2, failed: 0 }),
    })
    expect(worker).toMatchObject({
      claimed: 2,
      completed: 1,
      pending: 1,
      deadLetter: 0,
      failed: 0,
      recordingArchive: { inspected: 2, archived: 2, failed: 0 },
    })
    expect(finish).toHaveBeenNthCalledWith(1, expect.objectContaining({ queueId: 'queue-1', success: true }))
    expect(finish).toHaveBeenNthCalledWith(2, { queueId: 'queue-2', success: false, error: 'temporary failure' })
  })
})
