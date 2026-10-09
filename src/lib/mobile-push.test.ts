import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  afterWork: [] as Array<() => unknown | Promise<unknown>>,
}))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }))
vi.mock('@/lib/after-request', () => ({
  afterRequest: (work: () => unknown | Promise<unknown>) => {
    mocks.afterWork.push(work)
  },
}))

import {
  EXPO_RECEIPT_DELAY_MS,
  isMobilePushConfigured,
  maskExpoPushToken,
  sendMobilePushToAgentNames,
  sendMobilePushToUsers,
} from '@/lib/mobile-push'

const TOKEN_A = 'ExponentPushToken[deviceA123456]'
const TOKEN_B = 'ExponentPushToken[deviceB123456]'
const TOKEN_STALE = 'ExponentPushToken[staleDevice12]'

function devicesQuery(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue(result),
    }),
  }
}

function deleteQuery(onDelete: (tokens: string[]) => void) {
  return {
    delete: vi.fn().mockReturnValue({
      in: vi.fn(async (_column: string, tokens: string[]) => {
        onDelete(tokens)
        return { error: null }
      }),
    }),
  }
}

describe('sendMobilePushToUsers', () => {
  const fetchImpl = vi.fn()
  const deleted: string[] = []

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.afterWork.length = 0
    deleted.length = 0
    vi.unstubAllEnvs()
    vi.stubEnv('MOBILE_PUSH_ENABLED', 'true')
    vi.stubGlobal('fetch', fetchImpl)
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [{ status: 'ok', id: 'ticket-1' }, { status: 'ok', id: 'ticket-2' }] }),
    })
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'mobile_push_devices') throw new Error(`unexpected table:${table}`)
      return {
        ...devicesQuery({
          data: [
            { token: TOKEN_A, user_id: 'user-ernest' },
            { token: TOKEN_B, user_id: 'user-casey' },
          ],
          error: null,
        }),
        ...deleteQuery((tokens) => deleted.push(...tokens)),
      }
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('posts one Expo message per device and stamps recipientUserId from the device row', async () => {
    const sent = await sendMobilePushToUsers(['user-ernest', 'user-casey'], {
      title: 'Pat Seller',
      body: 'Re: 44 Oak Ave · Call me after 5.',
      data: {
        href: '/conversation/lead-1',
        kind: 'inbound_email',
        leadId: 'lead-1',
        eventId: 'email_act-1',
      },
    })

    expect(sent).toBe(2)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(fetchImpl.mock.calls[0][0]).toBe('https://exp.host/--/api/v2/push/send')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({
      Accept: 'application/json',
      'Content-Type': 'application/json',
    })
    expect(init.headers).not.toHaveProperty('Authorization')
    expect(JSON.parse(String(init.body))).toEqual([
      {
        to: TOKEN_A,
        title: 'Pat Seller',
        body: 'Re: 44 Oak Ave · Call me after 5.',
        data: {
          href: '/conversation/lead-1',
          kind: 'inbound_email',
          leadId: 'lead-1',
          eventId: 'email_act-1',
          recipientUserId: 'user-ernest',
        },
      },
      {
        to: TOKEN_B,
        title: 'Pat Seller',
        body: 'Re: 44 Oak Ave · Call me after 5.',
        data: {
          href: '/conversation/lead-1',
          kind: 'inbound_email',
          leadId: 'lead-1',
          eventId: 'email_act-1',
          recipientUserId: 'user-casey',
        },
      },
    ])
  })

  it('sends the Expo access token when EXPO_ACCESS_TOKEN is set', async () => {
    vi.stubEnv('EXPO_ACCESS_TOKEN', 'expo-secret')
    await sendMobilePushToUsers(['user-ernest'], { title: 'Title', body: 'Body' })
    const headers = (fetchImpl.mock.calls[0][1] as RequestInit).headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer expo-secret')
  })

  it('removes DeviceNotRegistered tokens and does not throw into callers', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table !== 'mobile_push_devices') throw new Error(`unexpected table:${table}`)
      return {
        ...devicesQuery({
          data: [
            { token: TOKEN_STALE, user_id: 'user-ernest' },
            { token: TOKEN_A, user_id: 'user-ernest' },
          ],
          error: null,
        }),
        ...deleteQuery((tokens) => deleted.push(...tokens)),
      }
    })
    fetchImpl.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        data: [
          { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } },
          { status: 'ok', id: 'ticket-2' },
        ],
      }),
    })
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)

    await expect(sendMobilePushToUsers(['user-ernest'], { title: 'Title', body: 'Body' })).resolves.toBe(1)
    expect(deleted).toEqual([TOKEN_STALE])
    expect(log).toHaveBeenCalledWith('[mobile-push] sent 1/2')
    expect(log).toHaveBeenCalledWith('[mobile-push] ticket', {
      id: null,
      status: 'error',
      error: 'DeviceNotRegistered',
      message: 'not registered',
      token: maskExpoPushToken(TOKEN_STALE),
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN_STALE)
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN_A)
    log.mockRestore()
  })

  it('logs every Expo ticket with a masked token', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await sendMobilePushToUsers(['user-ernest', 'user-casey'], { title: 'Title', body: 'Body' })
    expect(log).toHaveBeenCalledWith('[mobile-push] ticket', {
      id: 'ticket-1',
      status: 'ok',
      error: null,
      message: null,
      token: maskExpoPushToken(TOKEN_A),
    })
    expect(log).toHaveBeenCalledWith('[mobile-push] ticket', {
      id: 'ticket-2',
      status: 'ok',
      error: null,
      message: null,
      token: maskExpoPushToken(TOKEN_B),
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN_A)
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN_B)
    log.mockRestore()
  })

  it('checks Expo receipts after a delay and deletes DeviceNotRegistered tokens', async () => {
    vi.useFakeTimers()
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await sendMobilePushToUsers(['user-ernest', 'user-casey'], { title: 'Title', body: 'Body' })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(mocks.afterWork).toHaveLength(1)
    expect(deleted).toEqual([])

    fetchImpl.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        data: {
          'ticket-1': { status: 'ok' },
          'ticket-2': { status: 'error', message: 'The device is no longer registered', details: { error: 'DeviceNotRegistered' } },
        },
      }),
    })

    const pending = Promise.resolve(mocks.afterWork[0]())
    await vi.advanceTimersByTimeAsync(EXPO_RECEIPT_DELAY_MS)
    await pending

    expect(fetchImpl.mock.calls[1][0]).toBe('https://exp.host/--/api/v2/push/getReceipts')
    expect(JSON.parse(String((fetchImpl.mock.calls[1][1] as RequestInit).body))).toEqual({
      ids: ['ticket-1', 'ticket-2'],
    })
    expect(deleted).toEqual([TOKEN_B])
    expect(log).toHaveBeenCalledWith('[mobile-push] receipt', {
      id: 'ticket-2',
      status: 'error',
      error: 'DeviceNotRegistered',
      message: 'The device is no longer registered',
      token: maskExpoPushToken(TOKEN_B),
    })
    expect(JSON.stringify(log.mock.calls)).not.toContain(TOKEN_B)
    log.mockRestore()
    vi.useRealTimers()
  })

  it('returns 0 and does not throw when Expo or the device registry fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    fetchImpl.mockRejectedValue(new Error('network down'))
    await expect(sendMobilePushToUsers(['user-ernest'], { title: 'Title', body: 'Body' })).resolves.toBe(0)

    mocks.from.mockImplementation(() => {
      throw new Error('admin unavailable')
    })
    await expect(sendMobilePushToUsers(['user-ernest'], { title: 'Title', body: 'Body' })).resolves.toBe(0)
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })

  it('resolves agent names to user ids before sending', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'agent_profiles') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: [
                { user_id: 'user-ernest', email: 'ernest@savingkc.com' },
                { user_id: 'user-casey', email: 'casey@savingkc.com' },
              ],
              error: null,
            }),
          }),
        }
      }
      if (table !== 'mobile_push_devices') throw new Error(`unexpected table:${table}`)
      return {
        ...devicesQuery({
          data: [{ token: TOKEN_A, user_id: 'user-ernest' }],
          error: null,
        }),
        ...deleteQuery((tokens) => deleted.push(...tokens)),
      }
    })

    await sendMobilePushToAgentNames(['Ernest', 'Casey'], {
      title: 'Lead Texted',
      body: 'Please call me',
      data: {
        href: '/conversation/lead-123',
        kind: 'inbound_sms',
        leadId: 'lead-123',
        eventId: 'sms_SM123',
      },
    })

    expect(JSON.parse(String((fetchImpl.mock.calls[0][1] as RequestInit).body))).toEqual([
      expect.objectContaining({
        to: TOKEN_A,
        data: expect.objectContaining({
          kind: 'inbound_sms',
          eventId: 'sms_SM123',
          recipientUserId: 'user-ernest',
        }),
      }),
    ])
  })

  it('returns 0 without contacting Expo when no agent names are given', async () => {
    await expect(sendMobilePushToAgentNames([], { title: 'Title', body: 'Body' })).resolves.toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not contact Expo when dispatch is not configured', async () => {
    vi.stubEnv('MOBILE_PUSH_ENABLED', '')
    vi.stubEnv('EXPO_ACCESS_TOKEN', '')
    await expect(sendMobilePushToUsers(['user-ernest'], { title: 'Title', body: 'Body' })).resolves.toBe(0)
    expect(fetchImpl).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})

describe('maskExpoPushToken', () => {
  it('masks Expo tokens without logging the full value', () => {
    expect(maskExpoPushToken(TOKEN_A)).toBe('ExponentPushToken[devi…3456]')
    expect(maskExpoPushToken(TOKEN_A)).not.toBe(TOKEN_A)
  })
})

describe('isMobilePushConfigured', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is false until MOBILE_PUSH_ENABLED or EXPO_ACCESS_TOKEN is set', () => {
    vi.stubEnv('MOBILE_PUSH_ENABLED', '')
    vi.stubEnv('EXPO_ACCESS_TOKEN', '')
    expect(isMobilePushConfigured()).toBe(false)
  })

  it('is true when MOBILE_PUSH_ENABLED=true or EXPO_ACCESS_TOKEN is present', () => {
    vi.stubEnv('MOBILE_PUSH_ENABLED', 'true')
    vi.stubEnv('EXPO_ACCESS_TOKEN', '')
    expect(isMobilePushConfigured()).toBe(true)
    vi.stubEnv('MOBILE_PUSH_ENABLED', '')
    vi.stubEnv('EXPO_ACCESS_TOKEN', 'expo-secret')
    expect(isMobilePushConfigured()).toBe(true)
  })
})
