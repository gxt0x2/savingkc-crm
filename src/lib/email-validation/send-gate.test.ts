import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isHardBounce } from './bounce'
import { blockedEmailStatus, type EmailStatusClient } from './gate'
import { isBadEmailStatus } from './status'

const send = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: class {
    emails = { send }
  },
}))

vi.mock('@/lib/preview-safety', () => ({
  externalSideEffectsDisabled: () => false,
}))

import { sendGmailMessage } from '@/lib/gmail-send'
import { sendCrmTransactionalEmail } from '@/lib/server/transactional-email'

function client(status: string | null, fails = false): EmailStatusClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => fails
            ? { data: null, error: { message: 'ledger unavailable' } }
            : { data: status ? { email_status: status } : null, error: null },
        }),
      }),
    }),
  }
}

const senders = [
  'src/lib/gmail-send.ts',
  'src/lib/server/transactional-email.ts',
  'src/lib/server/appointment-sequence.ts',
  'src/app/api/broadcasts/send/route.ts',
  'src/app/api/mobile/v1/messages/route.ts',
  'src/app/api/tc/drafts/[id]/send/route.ts',
]

describe('bad addresses are excluded from sending', () => {
  beforeEach(() => {
    send.mockReset()
    send.mockResolvedValue({ data: { id: 'email-1' } })
    vi.stubEnv('RESEND_API_KEY', 'test-key')
    vi.stubEnv('RESEND_FROM_EMAIL', 'crm-mail@example.com')
  })

  it.each(['invalid', 'disposable'] as const)('does not call Gmail for %s', async (status) => {
    const fetchImpl = vi.fn()
    const result = await sendGmailMessage({
      accessToken: 'token',
      from: 'ernest@savingkc.com',
      to: 'seller@example.com',
      subject: 'Hello',
      text: 'Hello',
      fetchImpl,
      validationClient: client(status),
    })
    expect(result).toMatchObject({ ok: false, code: 'invalid_recipient' })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it.each([null, 'valid', 'catch_all', 'unknown', 'unverified'])('allows Gmail when the ledger says %s', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'msg-1', threadId: 'thread-1' }), { status: 200 }))
    const result = await sendGmailMessage({
      accessToken: 'token',
      from: 'ernest@savingkc.com',
      to: 'seller@example.com',
      subject: 'Hello',
      text: 'Hello',
      fetchImpl,
      validationClient: client(status),
    })
    expect(result).toMatchObject({ ok: true, id: 'msg-1' })
    expect(fetchImpl).toHaveBeenCalledOnce()
  })

  it('does not call Resend for an invalid transactional recipient', async () => {
    const result = await sendCrmTransactionalEmail({
      to: 'seller@example.com',
      subject: 'Appointment',
      text: 'See you tomorrow',
      validationClient: client('invalid'),
    })
    expect(result).toMatchObject({ success: false, status: 'failed' })
    expect(send).not.toHaveBeenCalled()
  })

  it('does not call Resend for a disposable transactional recipient', async () => {
    await sendCrmTransactionalEmail({
      to: 'seller@example.com',
      subject: 'Appointment',
      text: 'See you tomorrow',
      validationClient: client('disposable'),
    })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends transactional mail when the address is unverified', async () => {
    const result = await sendCrmTransactionalEmail({
      to: 'seller@example.com',
      subject: 'Appointment',
      text: 'See you tomorrow',
      validationClient: client('unverified'),
    })
    expect(result.status).toBe('sent')
    expect(send).toHaveBeenCalledOnce()
  })

  it('does not block a send when the ledger cannot be read', async () => {
    expect(await blockedEmailStatus('seller@example.com', client(null, true))).toBeNull()
  })

  it('treats a hard bounce as invalid and ignores a soft bounce', () => {
    expect(isHardBounce('email.bounced', 'Permanent')).toBe(true)
    expect(isHardBounce('email.bounced', 'Hard Bounce')).toBe(true)
    expect(isHardBounce('email.bounced', 'Transient')).toBe(false)
    expect(isHardBounce('email.bounced', null)).toBe(false)
    expect(isHardBounce('email.delivered', 'Permanent')).toBe(false)
    expect(isBadEmailStatus('invalid')).toBe(true)
  })

  it('wires the exclusion into every send path and portal enrollment', () => {
    const files = [
      ...senders,
      'src/lib/email/workflow/service.ts',
      'src/lib/email/workflow/queue-intent.ts',
      'src/lib/email/dispatch/service.ts',
      'src/lib/email/audiences/import.ts',
      'src/lib/email/inbound/delivery.ts',
      'src/lib/email/inbound/capture.ts',
      'src/lib/source-lists/import-source-list.ts',
      'src/app/api/email/audiences/route.ts',
    ]
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).toMatch(/blockedEmailStatus|isBadEmailStatus|emailBlockedInWorkflow|isHardBounce|bounceTypeFromPayload|recordWrittenEmails|coldLedgerReviewReasons|coldLedgerBlocksDispatch|coldLedgerDispatchHold/)
    }
    expect(readFileSync('src/lib/email-validation/cold-send.ts', 'utf8')).toContain('Email address cannot be mailed')
    expect(readFileSync('src/lib/email/inbound/delivery.ts', 'utf8')).toContain("provider='bounce'")
    expect(readFileSync('src/lib/email/dispatch/service.ts', 'utf8')).toContain('email_address_validations')
    expect(readFileSync('src/lib/email/audiences/import.ts', 'utf8')).toContain('coldLedgerReviewReasons')
    expect(readFileSync('src/lib/email/audiences/import.ts', 'utf8')).toContain('verificationStateIgnoringLedger')
  })
})
