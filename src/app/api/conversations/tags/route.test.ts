import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { DELETE, GET, POST } from './route'

let storedValue: string | null
let upsertPayloads: Array<Record<string, unknown>>

function makeRequest(method: string, body?: Record<string, unknown>): Request {
  return new Request('https://crm.savingkc.com/api/conversations/tags', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

function tableChain(table: string) {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        single: vi.fn(async () => {
          if (table !== 'system_config') return { data: null, error: { message: 'Unexpected table' } }
          if (!storedValue) return { data: null, error: { code: 'PGRST116', message: 'No rows' } }
          return { data: { value: storedValue }, error: null }
        }),
      })),
    })),
    upsert: vi.fn(async (payload: Record<string, unknown>) => {
      if (table === 'system_config') {
        upsertPayloads.push(payload)
        storedValue = String(payload.value)
      }
      return { error: null }
    }),
  }
}

describe('conversation tag catalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storedValue = null
    upsertPayloads = []
    mocks.from.mockImplementation((table: string) => tableChain(table))
  })

  it('returns the default prospecting tags when no catalog is stored', async () => {
    const response = await GET()
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'call_scheduled', label: 'Call Scheduled' }),
      expect.objectContaining({ id: 'realtor_referral', label: 'Realtor Referral' }),
    ]))
  })

  it('creates a custom tag and persists the merged catalog', async () => {
    const response = await POST(makeRequest('POST', {
      label: 'Seller Needs Call',
      color: '#123abc',
    }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.tag).toMatchObject({
      id: 'seller_needs_call',
      label: 'Seller Needs Call',
      color: '#123ABC',
    })
    expect(upsertPayloads).toHaveLength(1)
    expect(upsertPayloads[0]).toMatchObject({ key: 'conversation_tag_catalog' })
    expect(JSON.parse(String(upsertPayloads[0].value)).tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'seller_needs_call', archived: false }),
    ]))
  })

  it('archives deleted tags without returning them as active options', async () => {
    storedValue = JSON.stringify({
      tags: [
        { id: 'old_tag', label: 'Old Tag', color: '#111111' },
      ],
    })

    const response = await DELETE(makeRequest('DELETE', { id: 'old_tag' }))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.deleted).toBe(true)
    expect(payload.tags.some((tag: { id: string }) => tag.id === 'old_tag')).toBe(false)
    expect(JSON.parse(String(upsertPayloads[0].value)).tags).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'old_tag', archived: true }),
    ]))
  })
})
