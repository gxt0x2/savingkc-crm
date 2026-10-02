import { readFileSync } from 'node:fs'

import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getCurrentUserEmail: vi.fn(),
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { POST } from './route'

const august = JSON.parse(readFileSync('src/data/wholesale-market/august-2026.json', 'utf8')) as Record<string, unknown>
let actor: { role: string; is_admin: boolean } | null
let upserted: Record<string, unknown> | null
const tables: string[] = []

function post(body: unknown) {
  return new NextRequest('https://crm.savingkc.com/api/market-watch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('market watch upload', () => {
  beforeEach(() => {
    actor = { role: 'owner', is_admin: false }
    upserted = null
    tables.length = 0
    mocks.getCurrentUserEmail.mockResolvedValue('ernest@savingkc.com')
    mocks.from.mockImplementation((table: string) => {
      tables.push(table)
      if (table === 'agent_profiles') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: actor, error: null }) }) }) }
      }
      return {
        upsert: async (row: Record<string, unknown>) => {
          upserted = row
          return { error: null }
        },
      }
    })
  })

  it('stores an owner upload on the snapshot table only', async () => {
    const response = await POST(post(august))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, month_key: '2026-08', fit_zip_count: 28 })
    expect(upserted).toMatchObject({ month_key: '2026-08', uploaded_by: 'ernest@savingkc.com' })
    expect(tables).toEqual(['agent_profiles', 'wholesale_market_snapshots'])
  })

  it('refuses agents and unsigned requests before writing a snapshot', async () => {
    actor = { role: 'agent', is_admin: false }
    const forbidden = await POST(post(august))
    expect(forbidden.status).toBe(403)
    expect(tables).toEqual(['agent_profiles'])

    tables.length = 0
    mocks.getCurrentUserEmail.mockResolvedValue(null)
    const unauthorized = await POST(post(august))
    expect(unauthorized.status).toBe(401)
    expect(tables).toEqual([])
  })

  it('rejects a snapshot that does not match its own zip count', async () => {
    const broken = structuredClone(august) as { summary: { fit_zip_count: number } }
    broken.summary.fit_zip_count = 99
    const response = await POST(post(broken))
    expect(response.status).toBe(400)
    expect(upserted).toBeNull()
    expect(tables).toEqual(['agent_profiles'])
  })
})
