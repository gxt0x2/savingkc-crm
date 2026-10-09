import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUserEmail: vi.fn(),
  sendConnectedGmail: vi.fn(),
  recordOutboundGmail: vi.fn(),
  insert: vi.fn(),
  checkAutoAdvance: vi.fn(),
  assertManualLeadEmailSend: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

vi.mock('@/lib/gmail-send', async (original) => ({
  ...await original<typeof import('@/lib/gmail-send')>(),
  sendConnectedGmail: mocks.sendConnectedGmail,
  recordOutboundGmail: mocks.recordOutboundGmail,
}))

vi.mock('@/lib/server/manual-email-consent', () => ({
  assertManualLeadEmailSend: mocks.assertManualLeadEmailSend,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: () => ({ insert: mocks.insert }) },
}))

vi.mock('@/lib/pipeline-auto-advance', () => ({
  checkAutoAdvance: mocks.checkAutoAdvance,
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/auth/google/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/auth/google/send', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getCurrentUserEmail.mockResolvedValue('ernest@savingkc.com')
    mocks.assertManualLeadEmailSend.mockResolvedValue({ ok: true, to: 'savingkc@gmail.com' })
    mocks.recordOutboundGmail.mockResolvedValue({ persisted: true })
    mocks.insert.mockResolvedValue({ error: null })
    mocks.checkAutoAdvance.mockResolvedValue(undefined)
  })

  it('rejects anonymous send', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue(null)
    const response = await POST(request({ to: 'seller@example.com', body: 'Hello' }))
    expect(response.status).toBe(401)
    expect(mocks.sendConnectedGmail).not.toHaveBeenCalled()
  })

  it('fails closed when Gmail is not connected', async () => {
    mocks.sendConnectedGmail.mockResolvedValue({
      ok: false,
      code: 'no_token',
      error: 'Gmail is not connected. Connect Gmail in Settings, then try again.',
    })
    const response = await POST(request({ to: 'seller@example.com', body: 'Hello' }))
    const payload = await response.json()
    expect(response.status).toBe(403)
    expect(payload).toMatchObject({ success: false, sent: false, code: 'no_token' })
  })

  it('sends through the connected Gmail grant and stores lead history', async () => {
    mocks.sendConnectedGmail.mockResolvedValue({
      ok: true,
      id: 'msg-1',
      threadId: 'thread-1',
      from: 'ernest@savingkc.com',
    })
    const response = await POST(request({
      to: 'savingkc@gmail.com',
      subject: 'Demo',
      body: 'Sent from Settings',
      leadId: 'lead-1',
      user_email: 'ernest@savingkc.com',
    }))
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, sent: true, persisted: true, provider: 'gmail', id: 'msg-1' })
    expect(mocks.sendConnectedGmail).toHaveBeenCalledWith(expect.objectContaining({
      userEmail: 'ernest@savingkc.com',
      to: 'savingkc@gmail.com',
    }))
    expect(mocks.recordOutboundGmail).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      gmailMessageId: 'msg-1',
    }))
  })

  it('rejects an admin mailbox override before Gmail is called', async () => {
    const response = await POST(request({
      to: 'savingkc@gmail.com',
      body: 'Hello',
      leadId: 'lead-1',
      user_email: 'someone-else@savingkc.com',
    }))
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toMatchObject({ code: 'user_email_override', sent: false })
    expect(mocks.sendConnectedGmail).not.toHaveBeenCalled()
  })

  it('does not send when the lead email gate refuses', async () => {
    mocks.assertManualLeadEmailSend.mockResolvedValue({
      ok: false,
      status: 409,
      code: 'email_consent_unknown',
      error: 'Email suppression status is unknown, so this send was not attempted.',
    })
    const response = await POST(request({
      to: 'savingkc@gmail.com',
      body: 'Hello',
      leadId: 'lead-1',
    }))
    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toMatchObject({ sent: false, code: 'email_consent_unknown' })
    expect(mocks.sendConnectedGmail).not.toHaveBeenCalled()
  })

  it('does not record or resubmit an ambiguous Gmail result', async () => {
    mocks.sendConnectedGmail.mockResolvedValue({
      ok: false,
      code: 'gmail_result_ambiguous',
      error: 'Gmail did not confirm whether this message was sent. Do not send it again.',
    })
    const response = await POST(request({
      to: 'savingkc@gmail.com',
      body: 'Hello',
      leadId: 'lead-1',
    }))
    expect(response.status).toBe(504)
    await expect(response.json()).resolves.toMatchObject({
      sent: null,
      code: 'gmail_result_ambiguous',
      deliveryState: 'delivery_unknown',
    })
    expect(mocks.sendConnectedGmail).toHaveBeenCalledOnce()
    expect(mocks.recordOutboundGmail).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('reports Gmail accepted the message when CRM history did not save', async () => {
    mocks.sendConnectedGmail.mockResolvedValue({
      ok: true,
      id: 'msg-1',
      threadId: 'thread-1',
      from: 'ernest@savingkc.com',
    })
    mocks.insert.mockResolvedValue({ error: { message: 'insert failed' } })
    const response = await POST(request({
      to: 'savingkc@gmail.com',
      body: 'Hello',
      leadId: 'lead-1',
    }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      sent: true,
      persisted: false,
      provider: 'gmail',
      id: 'msg-1',
    })
  })
})
