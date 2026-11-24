import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  disabled: vi.fn(),
}))

vi.mock('resend', () => ({
  Resend: class {
    emails = { send: mocks.send }
  },
}))

vi.mock('@/lib/preview-safety', () => ({
  externalSideEffectsDisabled: mocks.disabled,
}))

import { sendCrmTransactionalEmail } from './transactional-email'

describe('sendCrmTransactionalEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.disabled.mockReturnValue(false)
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'crm-mail@example.com')
  })

  it('sends from the CRM transactional sender, not a marketing mailbox', async () => {
    mocks.send.mockResolvedValue({ data: { id: 'email-1' } })

    const result = await sendCrmTransactionalEmail({
      to: 'ernest@savingkc.com',
      subject: 'Website lead',
      text: 'New website lead',
      idempotencyKey: 'lead-alert-1',
    })

    expect(result).toEqual({ success: true, status: 'sent', id: 'email-1', error: null })
    expect(mocks.send).toHaveBeenCalledWith({
      from: 'Saving KC CRM <crm-mail@example.com>',
      to: ['ernest@savingkc.com'],
      subject: 'Website lead',
      text: 'New website lead',
    }, { idempotencyKey: 'lead-alert-1' })
    expect(mocks.send.mock.calls[0][0].from).not.toMatch(/marketing|newsletter/i)
  })

  it('records not_configured when the transactional sender is missing', async () => {
    vi.stubEnv('RESEND_API_KEY', '')
    vi.stubEnv('RESEND_FROM_EMAIL', '')

    const result = await sendCrmTransactionalEmail({
      to: 'ernest@savingkc.com',
      subject: 'Website lead',
      text: 'New website lead',
    })

    expect(result).toEqual({
      success: false,
      status: 'not_configured',
      id: null,
      error: 'Transactional email sender is not configured',
    })
    expect(mocks.send).not.toHaveBeenCalled()
  })

  it('does not call Resend when external side effects are disabled', async () => {
    mocks.disabled.mockReturnValue(true)

    const result = await sendCrmTransactionalEmail({
      to: 'ernest@savingkc.com',
      subject: 'Website lead',
      text: 'New website lead',
    })

    expect(result.status).toBe('skipped')
    expect(mocks.send).not.toHaveBeenCalled()
  })
})
