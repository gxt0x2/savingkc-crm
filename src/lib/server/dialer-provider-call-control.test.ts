import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getTwilioClient: vi.fn(),
  update: vi.fn(),
}))

vi.mock('@/lib/safe-communications', () => ({ getTwilioClient: mocks.getTwilioClient }))

import { disconnectProviderCallForTakeover } from './dialer-provider-call-control'

const callSid = `CA${'1'.repeat(32)}`

describe('disconnectProviderCallForTakeover', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getTwilioClient.mockReturnValue({ calls: vi.fn(() => ({ update: mocks.update })) })
    mocks.update.mockResolvedValue({ sid: callSid, status: 'completed' })
  })

  it('ends the correlated Twilio call before the new browser starts dialing', async () => {
    await expect(disconnectProviderCallForTakeover(callSid)).resolves.toBe('disconnected')
    expect(mocks.update).toHaveBeenCalledWith({ status: 'completed' })
  })

  it('treats an already-ended provider call as safely disconnected', async () => {
    mocks.update.mockRejectedValue({ code: 20404, status: 404 })
    await expect(disconnectProviderCallForTakeover(callSid)).resolves.toBe('already_ended')
  })

  it('does not make an uncorrelated provider request', async () => {
    await expect(disconnectProviderCallForTakeover(null)).resolves.toBe('not_required')
    await expect(disconnectProviderCallForTakeover('CA-invalid')).resolves.toBe('unconfirmed')
    expect(mocks.getTwilioClient).not.toHaveBeenCalled()
  })
})
