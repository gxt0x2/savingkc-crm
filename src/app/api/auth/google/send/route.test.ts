import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUserEmail: vi.fn(),
  isCurrentUserAdmin: vi.fn(),
  sendConnectedGmail: vi.fn(),
  recordOutboundGmail: vi.fn(),
  insert: vi.fn(),
  checkAutoAdvance: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
  isCurrentUserAdmin: mocks.isCurrentUserAdmin,
}))

vi.mock('@/lib/gmail-send', () => ({
  sendConnectedGmail: mocks.sendConnectedGmail,
  recordOutboundGmail: mocks.recordOutboundGmail,
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
    mocks.isCurrentUserAdmin.mockResolvedValue(true)
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
      to: 'seller@example.com',
      subject: 'Demo',
      body: 'Sent from Settings',
      leadId: 'lead-1',
    }))
    const payload = await response.json()
    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ success: true, sent: true, provider: 'gmail', id: 'msg-1' })
    expect(mocks.recordOutboundGmail).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      gmailMessageId: 'msg-1',
    }))
  })
})
