import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  handleOptIn: vi.fn(),
  handleOptOut: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/sms-opt-out', () => ({
  handleOptIn: mocks.handleOptIn,
  handleOptOut: mocks.handleOptOut,
}))

import { POST } from './route'

const PHONE = '+19135550123'

let suppressionState: { is_opted_out: boolean; reason: string | null } | null
let insertedActivities: unknown[]

function makeRequest(action: string): Request {
  return new Request('https://crm.savingkc.com/api/conversations/phone-status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      leadId: 'lead-1',
      phone: PHONE,
      action,
      agent: 'Casey',
      prospectPhoneId: 'prospect-phone-1',
    }),
  })
}

function tableChain(table: string) {
  const chain: Record<string, unknown> = {}
  chain.select = vi.fn(() => chain)
  chain.eq = vi.fn(() => chain)
  chain.maybeSingle = vi.fn(async () => ({ data: suppressionState, error: null }))
  chain.insert = vi.fn(async (payload: unknown) => {
    if (table === 'lead_activities') insertedActivities.push(payload)
    return { error: null }
  })
  return chain
}

describe('conversation phone status actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    suppressionState = null
    insertedActivities = []
    mocks.handleOptOut.mockImplementation(async (_phone: string, reason: string) => {
      suppressionState = { is_opted_out: true, reason }
    })
    mocks.handleOptIn.mockImplementation(async () => {
      suppressionState = { is_opted_out: false, reason: null }
    })
    mocks.from.mockImplementation((table: string) => tableChain(table))
  })

  it('marks wrong number as suppressed and logs status activity', async () => {
    const response = await POST(makeRequest('wrong_number'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.handleOptOut).toHaveBeenCalledWith(PHONE, 'WRONG_NUMBER')
    expect(payload.smsSuppressed).toBe(true)
    expect(payload.suppressionReason).toBe('WRONG_NUMBER')
    expect(insertedActivities).toHaveLength(1)
    expect(insertedActivities[0]).toMatchObject({
      lead_id: 'lead-1',
      activity_type: 'status_change',
      metadata: {
        phone: PHONE,
        phone_status: 'wrong_number',
        sms_suppressed: true,
      },
    })
  })

  it('clears reversible manual suppression when marking verified', async () => {
    suppressionState = { is_opted_out: true, reason: 'WRONG_NUMBER' }

    const response = await POST(makeRequest('verified'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.handleOptIn).toHaveBeenCalledWith(PHONE)
    expect(payload.smsSuppressed).toBe(false)
    expect(payload.message).toContain('manual SMS suppression cleared')
  })

  it('does not clear existing DNC suppression when marking verified', async () => {
    suppressionState = { is_opted_out: true, reason: 'DNC' }

    const response = await POST(makeRequest('verified'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.handleOptIn).not.toHaveBeenCalled()
    expect(payload.smsSuppressed).toBe(true)
    expect(payload.suppressionReason).toBe('DNC')
    expect(payload.message).toContain('still blocks SMS')
  })

  it('preserves hard DNC suppression when another quality status is selected', async () => {
    suppressionState = { is_opted_out: true, reason: 'DNC' }

    const response = await POST(makeRequest('spam'))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.handleOptOut).not.toHaveBeenCalled()
    expect(payload.smsSuppressed).toBe(true)
    expect(payload.suppressionReason).toBe('DNC')
    expect(insertedActivities[0]).toMatchObject({
      metadata: {
        phone_status: 'spam',
        sms_suppressed: true,
      },
    })
  })
})
