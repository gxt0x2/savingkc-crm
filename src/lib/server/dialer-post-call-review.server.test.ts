import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getDialerSession: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  getDialerSession: mocks.getDialerSession,
}))

import {
  completeDialerPostCallReview,
  getDialerPostCallReview,
  markDialerPostCallProcessing,
} from './dialer-post-call-review'

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {
    update: vi.fn(),
    eq: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  }
  builder.update.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.select.mockReturnValue(builder)
  return builder
}

describe('dialer post-call review persistence', () => {
  beforeEach(() => vi.clearAllMocks())

  it('binds provider processing state to both the signed attempt and resolved lead', async () => {
    const builder = chain({ data: { id: 'attempt-row-1' }, error: null })
    mocks.from.mockReturnValue(builder)

    const updated = await markDialerPostCallProcessing({
      clientAttemptId: 'client-attempt-1',
      leadId: 'lead-1',
      providerCallSid: 'CA123',
      recordingSid: 'RE123',
    })

    expect(updated).toBe(true)
    expect(mocks.from).toHaveBeenCalledWith('dialer_session_attempts')
    expect(builder.eq).toHaveBeenCalledWith('client_attempt_id', 'client-attempt-1')
    expect(builder.eq).toHaveBeenCalledWith('lead_id', 'lead-1')
    expect(builder.update).toHaveBeenCalledWith(expect.objectContaining({
      post_call_status: 'processing',
      provider_call_sid: 'CA123',
      recording_sid: 'RE123',
    }))
  })

  it('persists a bounded ready snapshot rather than the transcript', async () => {
    const builder = chain({ data: { id: 'attempt-row-1' }, error: null })
    mocks.from.mockReturnValue(builder)

    await completeDialerPostCallReview({
      clientAttemptId: 'client-attempt-1',
      leadId: 'lead-1',
      providerCallSid: 'CA123',
      recordingSid: 'RE123',
      analysis: {
        aiSummary: 'Seller asked for a Friday follow-up.',
        motivationScore: 8,
        followUpAction: 'Call Friday',
        fullTranscript: 'This field must never be copied to the attempt projection.',
      },
    })

    const updates = builder.update.mock.calls[0]?.[0]
    expect(updates).toMatchObject({
      post_call_status: 'ready',
      post_call_summary: 'Seller asked for a Friday follow-up.',
      post_call_snapshot: expect.objectContaining({ motivationScore: 8, nextAction: 'Call Friday' }),
    })
    expect(JSON.stringify(updates)).not.toContain('This field must never be copied')
  })

  it('verifies session ownership before reading one attempt review', async () => {
    mocks.getDialerSession.mockResolvedValue({ id: 'session-1' })
    const builder = chain({
      data: { post_call_status: 'ready', post_call_summary: 'Ready', post_call_snapshot: {} },
      error: null,
    })
    mocks.from.mockReturnValue(builder)

    const review = await getDialerPostCallReview(
      { email: 'casey@savingkc.com', name: 'Casey' },
      'session-1',
      'client-attempt-1',
    )

    expect(mocks.getDialerSession).toHaveBeenCalledWith(
      { email: 'casey@savingkc.com', name: 'Casey' },
      'session-1',
    )
    expect(builder.eq).toHaveBeenCalledWith('session_id', 'session-1')
    expect(builder.eq).toHaveBeenCalledWith('client_attempt_id', 'client-attempt-1')
    expect(review).toMatchObject({ status: 'ready', summary: 'Ready' })
  })
})
