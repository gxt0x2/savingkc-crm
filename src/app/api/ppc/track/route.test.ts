import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  record: vi.fn(),
}))

vi.mock('@/lib/ppc/tracking-events', () => ({
  recordPpcTrackingEvent: mocks.record,
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/ppc/track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('POST /api/ppc/track', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.record.mockResolvedValue({ recorded: true, row: { is_test: true } })
  })

  it('keeps the website is_test flag and msclkid for the event writer', async () => {
    const response = await POST(request({
      eventId: 'sid-1:page_view:1',
      eventName: 'page_view',
      is_test: true,
      attribution: { msclkid: 'ms-click' },
      payload: { is_test: true },
    }))

    expect(response.status).toBe(200)
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'page_view',
      is_test: true,
      attribution: { msclkid: 'ms-click' },
      payload: expect.objectContaining({ is_test: true }),
    }))
  })

  it('accepts the string form of the website test flag without dropping the event', async () => {
    const response = await POST(request({
      eventId: 'sid-1:page_view:2',
      eventName: 'page_view',
      is_test: 'true',
    }))

    expect(response.status).toBe(200)
    expect(mocks.record).toHaveBeenCalledWith(expect.objectContaining({ is_test: 'true' }))
  })
})
