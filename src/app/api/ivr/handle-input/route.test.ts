import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ from: vi.fn(), valid: vi.fn() }))
vi.mock('@/lib/twilio-validate', () => ({ validateTwilioWebhook: mocks.valid }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { POST } from './route'

function table() {
  const chain = {
    select: () => chain,
    eq: () => chain,
    limit: () => chain,
    single: async () => ({ data: { id: 'lead-1' }, error: null }),
    update: () => ({ eq: async () => ({ error: null }) }),
    insert: async () => ({ error: null }),
  }
  return chain
}

function press(digit: string, query = '') {
  const body = new URLSearchParams({ Digits: digit })
  return new Request(`https://crm.savingkc.com/api/ivr/handle-input?from=%2B19137179716&callSid=CA1&calledNumber=%2B18164292900${query}`, {
    method: 'POST',
    body,
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
  })
}

describe('seller IVR press 1 / press 2', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    mocks.valid.mockResolvedValue(true)
    mocks.from.mockImplementation(() => table())
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'true')
  })

  it.each(['1', '2'])('press %s rings both SavingKC apps and both cells, with the caller on CallKit', async (digit) => {
    const text = await (await POST(press(digit))).text()
    expect(text).toContain('<Identity>ernest</Identity>')
    expect(text).toContain('<Identity>casey</Identity>')
    expect(text.indexOf('<Identity>ernest</Identity>')).toBeLessThan(text.indexOf('<Identity>casey</Identity>'))
    expect(text).toContain('<Parameter name="callerNumber" value="+19137179716" />')
    expect(text).toContain('/api/twilio-inbound-client-status')
    expect(text).toContain('callerId="+19137179716"')
    expect(text).toContain('timeout="30"')
    expect(text.match(/<Number url=/g)).toHaveLength(2)
    expect(text).toContain(`type=${digit === '1' ? 'seller' : 'non_seller'}`)
  })

  it('keeps cells only when in-app voice is off', async () => {
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'false')
    const text = await (await POST(press('1'))).text()
    expect(text).not.toContain('<Client')
    expect(text.match(/<Number url=/g)).toHaveLength(2)
    expect(text).toContain('timeout="25"')
  })

  it('leaves cold-callback press 1 on cells only', async () => {
    const text = await (await POST(press('1', '&coldcall=1'))).text()
    expect(text).not.toContain('<Client')
    expect(text.match(/<Number url=/g)).toHaveLength(2)
  })

  it('announces the connection before ringing on press 1 and 2', async () => {
    const text = await (await POST(press('1'))).text()
    expect(text.indexOf('Connecting you now')).toBeGreaterThan(-1)
    expect(text.indexOf('Connecting you now')).toBeLessThan(text.indexOf('<Dial'))
  })

  it('press 9 on the business line puts the caller on do-not-call and confirms before hanging up', async () => {
    const upserts: unknown[] = []
    mocks.from.mockImplementation((name: string) => name === 'sms_opt_outs'
      ? { upsert: async (row: unknown) => { upserts.push(row); return { error: null } } }
      : table())
    const text = await (await POST(press('9'))).text()
    expect(upserts[0]).toMatchObject({ phone: '+19137179716', is_opted_out: true, reason: 'DNC' })
    expect(text).toContain("You've been removed from our call list")
    expect(text).toContain('<Hangup />')
    expect(text).not.toContain('<Dial')
  })

  it('a wrong key on the business line gets the shorter retry menu, not a hang-up', async () => {
    const text = await (await POST(press('5'))).text()
    expect(text).toContain("Sorry, I didn't catch that")
    expect(text).toContain('/api/ivr/no-input?')
  })
})
