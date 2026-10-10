import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  sendMobilePushToUsers: vi.fn(),
  sendPushToUser: vi.fn(),
  afterRequest: vi.fn((work: () => unknown) => {
    void work()
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: mocks.from }) }))
vi.mock('@/lib/mobile-push', () => ({ sendMobilePushToUsers: mocks.sendMobilePushToUsers }))
vi.mock('@/lib/push-notifications', () => ({ sendPushToUser: mocks.sendPushToUser }))
vi.mock('@/lib/after-request', () => ({
  afterRequest: (work: () => unknown) => mocks.afterRequest(work),
}))

import { inboundEmailPushBody, inboundEmailRecipientEmails, notifyInboundEmail } from '@/lib/inbound-email-alert'

const LEAD_ID = 'lead-seller'
const ACTIVITY_ID = 'act-inbound-1'

function leadQuery(row: Record<string, unknown> | null, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error }),
      }),
    }),
  }
}

function profilesQuery(rows: Array<{ user_id: string; email: string }>, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      in: vi.fn().mockResolvedValue({ data: rows, error }),
    }),
  }
}

describe('inboundEmailRecipientEmails', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  it('maps assigned_agent to name@savingkc.com and always includes the owner', () => {
    expect(inboundEmailRecipientEmails('Casey', 'ernest@savingkc.com')).toEqual([
      'casey@savingkc.com',
      'ernest@savingkc.com',
    ])
    expect(inboundEmailRecipientEmails('Casey Davis', 'ernest@savingkc.com')).toEqual([
      'casey@savingkc.com',
      'ernest@savingkc.com',
    ])
  })

  it('de-dupes when the assigned agent is also the owner', () => {
    expect(inboundEmailRecipientEmails('Ernest', 'ernest@savingkc.com')).toEqual(['ernest@savingkc.com'])
    expect(inboundEmailRecipientEmails(' ernest ', 'Ernest@SavingKC.com')).toEqual(['ernest@savingkc.com'])
  })

  it('falls back to ernest@savingkc.com when OWNER_EMAIL is unset', () => {
    vi.stubEnv('OWNER_EMAIL', '')
    expect(inboundEmailRecipientEmails(null)).toEqual(['ernest@savingkc.com'])
    expect(inboundEmailRecipientEmails('')).toEqual(['ernest@savingkc.com'])
  })

  it('uses OWNER_EMAIL when set', () => {
    vi.stubEnv('OWNER_EMAIL', 'Casey@SavingKC.com')
    expect(inboundEmailRecipientEmails(null)).toEqual(['casey@savingkc.com'])
    expect(inboundEmailRecipientEmails('Ernest')).toEqual(['ernest@savingkc.com', 'casey@savingkc.com'])
  })
})

describe('inboundEmailPushBody', () => {
  it('uses the snippet, otherwise the start of the plain body, with whitespace collapsed', () => {
    expect(inboundEmailPushBody('Hi   The\nclosing...', 'ignored longer body')).toBe('Hi The closing...')
    expect(inboundEmailPushBody('  ', 'Hi\n\nThe closing is Thursday at the title company.')).toBe('Hi The closing is Thursday at the title company.')
    expect(inboundEmailPushBody('', 'x'.repeat(180))).toHaveLength(150)
    expect(inboundEmailPushBody('   ', '  \n')).toBe('New email')
  })
})

describe('notifyInboundEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
    mocks.afterRequest.mockImplementation((work: () => unknown) => {
      void work()
    })
    mocks.sendMobilePushToUsers.mockResolvedValue(1)
    mocks.sendPushToUser.mockResolvedValue(1)
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return leadQuery({
          id: LEAD_ID,
          full_name: 'Pat Seller',
          phone: '+18165550100',
          email: 'seller@example.com',
          assigned_agent: 'Casey',
        })
      }
      if (table === 'agent_profiles') {
        return profilesQuery([
          { user_id: 'user-casey', email: 'casey@savingkc.com' },
          { user_id: 'user-ernest', email: 'ernest@savingkc.com' },
        ])
      }
      throw new Error(`unexpected table:${table}`)
    })
  })

  it('notifies the assigned agent and owner with the inbound-email payload', async () => {
    await notifyInboundEmail({
      leadId: LEAD_ID,
      activityId: ACTIVITY_ID,
      subject: 'Re: 44 Oak Ave',
      snippet: 'Call me after 5.',
    })

    const payload = {
      title: 'Pat Seller',
      subtitle: 'Re: 44 Oak Ave',
      body: 'Call me after 5.',
      data: {
        href: `/conversation/${LEAD_ID}`,
        kind: 'inbound_email',
        leadId: LEAD_ID,
        eventId: `email_${ACTIVITY_ID}`,
      },
    }
    expect(mocks.sendMobilePushToUsers).toHaveBeenCalledWith(['user-casey', 'user-ernest'], payload)
    expect(mocks.sendPushToUser).toHaveBeenCalledTimes(2)
    expect(mocks.sendPushToUser).toHaveBeenCalledWith('user-casey', {
      title: 'Pat Seller',
      body: 'Call me after 5.',
      url: `/conversation/${LEAD_ID}`,
      tag: `email_${ACTIVITY_ID}`,
    })
  })

  it('puts the subject on the Expo subtitle and the plain-body preview in the body', async () => {
    await notifyInboundEmail({
      leadId: LEAD_ID,
      activityId: ACTIVITY_ID,
      subject: '  Request: Buyer Signing  ',
      snippet: '',
      bodyText: 'Hi\n\nThe closing is Thursday.',
    })

    expect(mocks.sendMobilePushToUsers).toHaveBeenCalledWith(['user-casey', 'user-ernest'], {
      title: 'Pat Seller',
      subtitle: 'Request: Buyer Signing',
      body: 'Hi The closing is Thursday.',
      data: {
        href: `/conversation/${LEAD_ID}`,
        kind: 'inbound_email',
        leadId: LEAD_ID,
        eventId: `email_${ACTIVITY_ID}`,
      },
    })
  })

  it('schedules Web and Expo push with after() so the caller can return first', async () => {
    const queued: Array<() => unknown> = []
    mocks.afterRequest.mockImplementation((work: () => unknown) => {
      queued.push(work)
    })

    await notifyInboundEmail({
      leadId: LEAD_ID,
      activityId: ACTIVITY_ID,
      subject: 'Re: 44 Oak Ave',
      snippet: 'Call me after 5.',
    })

    expect(mocks.sendMobilePushToUsers).not.toHaveBeenCalled()
    expect(mocks.sendPushToUser).not.toHaveBeenCalled()
    expect(queued).toHaveLength(1)
    await queued[0]()
    expect(mocks.sendMobilePushToUsers).toHaveBeenCalledWith(['user-casey', 'user-ernest'], expect.objectContaining({
      data: expect.objectContaining({ kind: 'inbound_email' }),
    }))
    expect(mocks.sendPushToUser).toHaveBeenCalledTimes(2)
  })

  it('de-dupes push recipients when the assigned agent is the owner', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return leadQuery({
          id: LEAD_ID,
          full_name: 'Pat Seller',
          phone: null,
          email: 'seller@example.com',
          assigned_agent: 'Ernest',
        })
      }
      if (table === 'agent_profiles') {
        return profilesQuery([{ user_id: 'user-ernest', email: 'ernest@savingkc.com' }])
      }
      throw new Error(`unexpected table:${table}`)
    })

    await notifyInboundEmail({
      leadId: LEAD_ID,
      activityId: ACTIVITY_ID,
      subject: 'Offer',
      snippet: 'Ready.',
    })

    expect(mocks.sendMobilePushToUsers).toHaveBeenCalledWith(['user-ernest'], expect.objectContaining({
      data: expect.objectContaining({ kind: 'inbound_email', eventId: `email_${ACTIVITY_ID}` }),
    }))
    expect(mocks.sendPushToUser).toHaveBeenCalledTimes(1)
    expect(mocks.sendPushToUser).toHaveBeenCalledWith('user-ernest', expect.any(Object))
  })

  it('uses the sender email when the lead has no display name', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return leadQuery({
          id: LEAD_ID,
          full_name: null,
          phone: null,
          email: 'seller@example.com',
          assigned_agent: null,
        })
      }
      if (table === 'agent_profiles') {
        return profilesQuery([{ user_id: 'user-ernest', email: 'ernest@savingkc.com' }])
      }
      throw new Error(`unexpected table:${table}`)
    })

    await notifyInboundEmail({
      leadId: LEAD_ID,
      activityId: ACTIVITY_ID,
      subject: 'Hello',
      snippet: 'Hi there',
    })

    expect(mocks.sendMobilePushToUsers).toHaveBeenCalledWith(
      ['user-ernest'],
      expect.objectContaining({ title: 'seller@example.com' }),
    )
  })

  it('does not throw when lookup or delivery fails', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mocks.from.mockImplementation(() => {
      throw new Error('db down')
    })
    await expect(notifyInboundEmail({
      leadId: LEAD_ID,
      activityId: ACTIVITY_ID,
      subject: 'Re: 44 Oak Ave',
      snippet: 'Call me after 5.',
    })).resolves.toBeUndefined()
    expect(mocks.sendMobilePushToUsers).not.toHaveBeenCalled()
    expect(errors).toHaveBeenCalled()
    errors.mockRestore()
  })
})
