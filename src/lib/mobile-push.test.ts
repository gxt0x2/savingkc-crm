import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }))

import { sendMobilePushToUsers } from '@/lib/mobile-push'

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
    deleted.length = 0
    vi.unstubAllEnvs()
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
    log.mockRestore()
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
})
