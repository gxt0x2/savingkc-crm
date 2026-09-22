import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { classifySmsOptOut, handleOptIn, handleOptOut, isOptedOut, isSmsOptOutMessage } from './sms-opt-out'

describe('SMS suppression persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null })
    mocks.upsert.mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: mocks.maybeSingle }),
        }),
      }),
      upsert: mocks.upsert,
    })
  })

  it('normalizes the number and treats no active row as callable', async () => {
    await expect(isOptedOut('(913) 555-0123')).resolves.toBe(false)
    expect(mocks.from).toHaveBeenCalledWith('sms_opt_outs')
  })

  it('fails closed when suppression status cannot be verified', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: 'database unavailable' } })

    await expect(isOptedOut('+19135550123')).rejects.toThrow('could not be verified')
  })

  it('does not silently acknowledge a failed opt-out write', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'write failed' } })

    await expect(handleOptOut('+19135550123', 'stop')).rejects.toThrow('could not be saved')
  })

  it('does not silently acknowledge a failed opt-in write', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'write failed' } })

    await expect(handleOptIn('+19135550123')).rejects.toThrow('could not be saved')
  })
})

describe('SMS opt-out language', () => {
  it.each([
    'STOP',
    'stop',
    'STOP.',
    'UNSUBSCRIBE',
    'CANCEL',
    'END',
    'QUIT',
    'STOPALL',
    'stop all',
  ])('treats exact carrier keyword %j as STOP-class opt-out', (message) => {
    expect(isSmsOptOutMessage(message)).toBe(true)
    expect(classifySmsOptOut(message)?.reason).not.toBe('NATURAL_LANGUAGE_OPT_OUT')
  })

  it.each([
    'Please stop texting me',
    'Stop texting this number',
    'Do not contact me',
    "Don't call or text me again",
    'Take me off your list',
    'Please remove me from your texts',
    'Unsubscribe me',
    'I want to opt out',
    'No more texts please',
    'DND',
    'This is a do not call number',
    'Leave me alone',
  ])('treats natural-language opt-out %j as an opt-out', (message) => {
    expect(classifySmsOptOut(message)).toEqual({ reason: 'NATURAL_LANGUAGE_OPT_OUT' })
  })

  it.each([
    'Yes I might want to sell',
    'Can you stop by the house Thursday?',
    'Please cancel the appointment',
    'Cancel please',
    'Stop by later',
    "Don't stop, I'm interested",
    'Please do not unsubscribe me',
    'Never stop texting me',
    "Don't call until Thursday",
    'End of the month works',
    'What is your offer?',
  ])('does not treat ordinary seller language %j as an opt-out', (message) => {
    expect(isSmsOptOutMessage(message)).toBe(false)
  })
})
