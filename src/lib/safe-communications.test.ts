import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createMessage: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  twilio: vi.fn(),
}))

vi.mock('twilio', () => ({
  default: mocks.twilio,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

const TWILIO_ENV_KEYS = [
  'TEST_MODE',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_API_KEY',
  'TWILIO_API_SECRET',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_MESSAGING_SERVICE',
] as const

async function importSafeCommunications() {
  vi.resetModules()
  mocks.createMessage.mockReset()
  mocks.from.mockReset()
  mocks.insert.mockReset()
  mocks.twilio.mockReset()
  mocks.from.mockReturnValue({ insert: mocks.insert })
  mocks.insert.mockResolvedValue({ data: null, error: null })

  return import('./safe-communications')
}

function clearTwilioEnv() {
  for (const key of TWILIO_ENV_KEYS) {
    vi.stubEnv(key, '')
  }
}

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('safeSendSMS', () => {
  it('returns a deployment config error when Twilio credentials are missing', async () => {
    clearTwilioEnv()
    const { safeSendSMS } = await importSafeCommunications()

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18166088588',
      body: 'Hello',
    })

    expect(result).toMatchObject({
      success: false,
      error: 'Twilio SMS is not configured: missing TWILIO_ACCOUNT_SID',
    })
    expect(mocks.twilio).not.toHaveBeenCalled()
    expect(mocks.from).toHaveBeenCalledWith('sms_delivery_log')
  })

  it('initializes Twilio at send time instead of import time', async () => {
    clearTwilioEnv()
    const { safeSendSMS } = await importSafeCommunications()

    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY', 'SK123')
    vi.stubEnv('TWILIO_API_SECRET', 'secret123')
    mocks.createMessage.mockResolvedValue({ sid: 'SM123', status: 'queued', from: '+18163077835' })
    mocks.twilio.mockReturnValue({ messages: { create: mocks.createMessage } })

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18166088588',
      body: 'Hello',
    })

    expect(result).toMatchObject({
      success: true,
      sid: 'SM123',
      status: 'queued',
    })
    expect(mocks.twilio).toHaveBeenCalledWith('SK123', 'secret123', {
      accountSid: 'AC123',
      timeout: 30_000,
    })
    expect(mocks.createMessage).toHaveBeenCalledWith({
      to: '+19135550123',
      from: '+18166088588',
      body: 'Hello',
    })
  })

  it('passes a campaign delivery callback to Twilio without changing ordinary sends', async () => {
    clearTwilioEnv()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY', 'SK123')
    vi.stubEnv('TWILIO_API_SECRET', 'secret123')
    const { safeSendSMS } = await importSafeCommunications()
    mocks.createMessage.mockResolvedValue({ sid: 'SM123', status: 'queued', from: '+18163077835' })
    mocks.twilio.mockReturnValue({ messages: { create: mocks.createMessage } })

    await safeSendSMS({
      to: '+19135550123', from: '+18166088588', body: 'Hello',
      statusCallback: 'https://crm.savingkc.com/api/twilio-message-status?action_id=campaign-action',
    })

    expect(mocks.createMessage).toHaveBeenCalledWith(expect.objectContaining({
      statusCallback: 'https://crm.savingkc.com/api/twilio-message-status?action_id=campaign-action',
    }))
  })

  it('does not submit to Twilio after a protected request is aborted', async () => {
    clearTwilioEnv()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY', 'SK123')
    vi.stubEnv('TWILIO_API_SECRET', 'secret123')
    const { safeSendSMS } = await importSafeCommunications()
    mocks.twilio.mockReturnValue({ messages: { create: mocks.createMessage } })
    const controller = new AbortController()
    controller.abort()

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18166088588',
      body: 'Hello',
      signal: controller.signal,
    })

    expect(result).toMatchObject({
      success: false,
      error: 'SMS delivery was cancelled before provider submission',
    })
    expect(mocks.createMessage).not.toHaveBeenCalled()
  })

  it('revalidates protected control after Twilio accepts and before delivery logging', async () => {
    clearTwilioEnv()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY', 'SK123')
    vi.stubEnv('TWILIO_API_SECRET', 'secret123')
    const { safeSendSMS } = await importSafeCommunications()
    mocks.createMessage.mockResolvedValue({ sid: 'SM123', status: 'queued', from: '+18166088588' })
    mocks.twilio.mockReturnValue({ messages: { create: mocks.createMessage } })
    const beforePostProviderWrite = vi.fn().mockResolvedValue(undefined)

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18166088588',
      body: 'Hello',
      beforePostProviderWrite,
    })

    expect(result).toMatchObject({ success: true, postProviderPersistenceBlocked: false })
    expect(beforePostProviderWrite).toHaveBeenCalledOnce()
    expect(beforePostProviderWrite.mock.invocationCallOrder[0]).toBeGreaterThan(mocks.createMessage.mock.invocationCallOrder[0])
    expect(beforePostProviderWrite.mock.invocationCallOrder[0]).toBeLessThan(mocks.insert.mock.invocationCallOrder[0])
  })

  it('does not record a protected provider success after control revalidation fails', async () => {
    clearTwilioEnv()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY', 'SK123')
    vi.stubEnv('TWILIO_API_SECRET', 'secret123')
    const { safeSendSMS } = await importSafeCommunications()
    mocks.createMessage.mockResolvedValue({ sid: 'SM123', status: 'queued', from: '+18166088588' })
    mocks.twilio.mockReturnValue({ messages: { create: mocks.createMessage } })

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18166088588',
      body: 'Hello',
      beforePostProviderWrite: vi.fn().mockRejectedValue(new Error('Dialing control moved')),
    })

    expect(result).toMatchObject({
      success: true,
      sid: 'SM123',
      postProviderPersistenceBlocked: true,
    })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('marks a protected Twilio timeout as delivery-unknown instead of retryable failure', async () => {
    clearTwilioEnv()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY', 'SK123')
    vi.stubEnv('TWILIO_API_SECRET', 'secret123')
    const { safeSendSMS } = await importSafeCommunications()
    mocks.createMessage.mockRejectedValue(Object.assign(new Error('socket timed out'), { code: 'ETIMEDOUT' }))
    mocks.twilio.mockReturnValue({ messages: { create: mocks.createMessage } })

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18166088588',
      body: 'Hello',
      signal: new AbortController().signal,
      beforePostProviderWrite: vi.fn().mockResolvedValue(undefined),
    })

    expect(result).toMatchObject({
      success: false,
      deliveryUnknown: true,
      error: expect.stringContaining('Do not resend'),
    })
  })

  it('treats a generic protected transport exception with no HTTP status as delivery-unknown', async () => {
    clearTwilioEnv()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY', 'SK123')
    vi.stubEnv('TWILIO_API_SECRET', 'secret123')
    const { safeSendSMS } = await importSafeCommunications()
    mocks.createMessage.mockRejectedValue(new Error('TLS connection ended unexpectedly'))
    mocks.twilio.mockReturnValue({ messages: { create: mocks.createMessage } })

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18166088588',
      body: 'Hello',
      signal: new AbortController().signal,
      beforePostProviderWrite: vi.fn().mockResolvedValue(undefined),
    })

    expect(result).toMatchObject({
      success: false,
      deliveryUnknown: true,
      error: expect.stringContaining('Do not resend'),
    })
  })

  it('keeps a protected Twilio HTTP rejection as a confirmed failure', async () => {
    clearTwilioEnv()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY', 'SK123')
    vi.stubEnv('TWILIO_API_SECRET', 'secret123')
    const { safeSendSMS } = await importSafeCommunications()
    mocks.createMessage.mockRejectedValue(Object.assign(new Error('Invalid destination'), {
      code: 21_211,
      status: 400,
    }))
    mocks.twilio.mockReturnValue({ messages: { create: mocks.createMessage } })

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18166088588',
      body: 'Hello',
      signal: new AbortController().signal,
      beforePostProviderWrite: vi.fn().mockResolvedValue(undefined),
    })

    expect(result).toMatchObject({
      success: false,
      deliveryUnknown: false,
      error: 'Invalid destination',
    })
  })

  it('records the provider sender and exposes any mismatch with the requested identity', async () => {
    clearTwilioEnv()
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'AC123')
    vi.stubEnv('TWILIO_API_KEY', 'SK123')
    vi.stubEnv('TWILIO_API_SECRET', 'secret123')
    const { safeSendSMS } = await importSafeCommunications()
    mocks.createMessage.mockResolvedValue({ sid: 'SM456', status: 'accepted', from: '+18163077835' })
    mocks.twilio.mockReturnValue({ messages: { create: mocks.createMessage } })

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18167277667',
      body: 'Hello',
      senderUse: 'conversation',
    })

    expect(result).toMatchObject({
      success: true,
      from: '+18163077835',
      requestedFrom: '+18167277667',
      senderMismatch: true,
    })
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ from_phone: '+18163077835' }))
  })

  it('blocks protected tracking numbers from ordinary conversation sends', async () => {
    clearTwilioEnv()
    const { safeSendSMS } = await importSafeCommunications()

    const result = await safeSendSMS({
      to: '+19135550123',
      from: '+18166088808',
      body: 'Hello',
      senderUse: 'conversation',
    })

    expect(result).toMatchObject({ success: false, error: expect.stringContaining('not approved') })
    expect(mocks.twilio).not.toHaveBeenCalled()
  })
})
