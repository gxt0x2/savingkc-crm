import { afterEach, describe, expect, it } from 'vitest'

import { resolveMobileEmailSender } from './email-sender'

describe('mobile email sender policy', () => {
  afterEach(() => {
    delete process.env.CRM_MOBILE_EMAIL_SENDERS
    delete process.env.RESEND_FROM_EMAIL
  })

  it('uses the authenticated actor mapped mailbox', () => {
    process.env.CRM_MOBILE_EMAIL_SENDERS = 'ernest@savingkc.com=ernest@savingkc.com,casey@savingkc.com=casey@savingkc.com'
    expect(resolveMobileEmailSender('casey@savingkc.com', 'Casey')).toEqual({
      email: 'casey@savingkc.com',
      from: 'Casey at SavingKC <casey@savingkc.com>',
    })
  })

  it('fails closed instead of assigning another users mailbox', () => {
    process.env.RESEND_FROM_EMAIL = 'ernest@savingkc.com'
    expect(resolveMobileEmailSender('casey@savingkc.com', 'Casey')).toBeNull()
  })
})
