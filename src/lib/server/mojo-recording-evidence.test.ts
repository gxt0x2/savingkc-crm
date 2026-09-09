import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  downloadRecording: vi.fn(),
  transcribeAudio: vi.fn(),
  analyzeCallTranscript: vi.fn(),
  createCallAnalysisLeadProposal: vi.fn(),
}))

vi.mock('@/lib/mojo-recording-downloader', () => ({ downloadRecording: mocks.downloadRecording }))
vi.mock('@/lib/mojo-transcriber', () => ({ transcribeAudio: mocks.transcribeAudio }))
vi.mock('@/lib/mojo-call-analyzer', () => ({ analyzeCallTranscript: mocks.analyzeCallTranscript }))
vi.mock('@/lib/server/ai-change-proposals', () => ({ createCallAnalysisLeadProposal: mocks.createCallAnalysisLeadProposal }))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: mocks.maybeSingle,
      }
      return query
    },
  }),
}))

import { processMojoRecordingEvidence } from './mojo-recording-evidence'
import type { MojoCallIngestResult, MojoCallRecord } from './mojo-call-import'

const call: MojoCallRecord = {
  record_id: 'mojo-1', contact_name: 'Seller', phone_number: '9135550123',
  property_address: '', city: '', state: 'MO', zip: '',
  call_date: '2026-09-08T19:16:00Z', call_duration: 758,
  disposition: 'Interested', agent_name: 'Casey',
  recording_url: 'https://app71.mojosells.com/audio/1',
}

const result: MojoCallIngestResult = {
  eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  leadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  activityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  outcome: 'meaningful_conversation', normalizedPhone: '+19135550123',
  unresolvedReason: null, callAt: '2026-09-08T19:16:00Z', followUpAt: null,
  station: 'contacted', assignedAgent: 'Casey', latestForLead: true, replayed: false,
  promotionEligible: true, qualificationStatus: 'eligible', qualificationReasons: ['minimum_duration_met'],
}

describe('Mojo recording evidence worker', () => {
  beforeEach(() => vi.clearAllMocks())

  it('does not process evidence for a non-promoted provider event', async () => {
    await expect(processMojoRecordingEvidence({ ...result, promotionEligible: false }, call)).resolves.toEqual({
      status: 'skipped', storagePath: null, summary: null,
    })
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
    expect(mocks.downloadRecording).not.toHaveBeenCalled()
  })

  it('does not pay to transcribe an event that is already analyzed', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { recording_storage_path: 'events/a.mp3', recording_processing_status: 'analyzed' },
      error: null,
    })
    await expect(processMojoRecordingEvidence(result, call)).resolves.toEqual({
      status: 'already_analyzed', storagePath: 'events/a.mp3', summary: null,
    })
    expect(mocks.downloadRecording).not.toHaveBeenCalled()
    expect(mocks.transcribeAudio).not.toHaveBeenCalled()
  })
})
