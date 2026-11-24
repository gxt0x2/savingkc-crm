import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { rememberOutboundParentCallSid } from './dialer-parent-call'

const PARENT_SID = `CA${'b'.repeat(32)}`

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {
    update: vi.fn(),
    eq: vi.fn(),
    is: vi.fn(),
    select: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  }
  builder.update.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.is.mockReturnValue(builder)
  builder.select.mockReturnValue(builder)
  return builder
}

describe('rememberOutboundParentCallSid', () => {
  beforeEach(() => vi.clearAllMocks())

  it('stores a parent Call SID only while the attempt has none', async () => {
    const builder = chain({ data: { id: 'attempt-row' }, error: null })
    mocks.from.mockReturnValue(builder)

    const saved = await rememberOutboundParentCallSid({
      clientAttemptId: 'attempt-2',
      callSid: PARENT_SID,
      sessionId: 'session-1',
    })

    expect(saved).toBe(true)
    expect(mocks.from).toHaveBeenCalledWith('dialer_session_attempts')
    expect(builder.update).toHaveBeenCalledWith({ provider_call_sid: PARENT_SID })
    expect(builder.eq).toHaveBeenCalledWith('client_attempt_id', 'attempt-2')
    expect(builder.eq).toHaveBeenCalledWith('session_id', 'session-1')
    expect(builder.is).toHaveBeenCalledWith('provider_call_sid', null)
  })

  it('ignores a missing or malformed Call SID', async () => {
    expect(await rememberOutboundParentCallSid({ clientAttemptId: 'attempt-2', callSid: 'CA_test' })).toBe(false)
    expect(await rememberOutboundParentCallSid({ clientAttemptId: '  ', callSid: PARENT_SID })).toBe(false)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
