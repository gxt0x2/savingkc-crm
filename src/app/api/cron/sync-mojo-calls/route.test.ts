import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sync: vi.fn(),
  db: {
    from: vi.fn(),
    rpc: vi.fn(),
  },
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/mojo-dial-ingest', async () => {
  const actual = await vi.importActual<typeof import('@/lib/server/mojo-dial-ingest')>('@/lib/server/mojo-dial-ingest')
  return { ...actual, syncMojoDialIngest: mocks.sync }
})
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => mocks.db }))

import { MojoDialIngestError } from '@/lib/server/mojo-dial-ingest'
import { GET } from './route'

describe('/api/cron/sync-mojo-calls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.db.from.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { value: 'stored-session' }, error: null }),
        }),
      }),
      upsert: async () => ({ error: null }),
    })
    mocks.sync.mockResolvedValue({
      ok: true,
      source: 'mojo_session_calling_report',
      from: '2026-10-28',
      to: '2026-10-28',
      catchingUp: true,
      cursor: '2026-10-29',
      calls: 4,
      eventsInserted: 4,
      eventsReplayed: 0,
      phonesUpdated: 1,
    })
  })

  it('rejects an untrusted request before reading Mojo', async () => {
    mocks.auth.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/sync-mojo-calls') as never)
    expect(response.status).toBe(401)
    expect(mocks.sync).not.toHaveBeenCalled()
  })

  it('returns the catch-up window with no-store semantics and no phone numbers', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/sync-mojo-calls') as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    const body = await response.json()
    expect(body).toMatchObject({ ok: true, from: '2026-10-28', cursor: '2026-10-29', calls: 4 })
    expect(JSON.stringify(body)).not.toContain('stored-session')
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'stored-session' }))
  })

  it('reports missing credentials without inventing a secret', async () => {
    mocks.sync.mockRejectedValue(new MojoDialIngestError(
      'credentials_missing',
      'Mojo call ingest has no stored session and no MCP credentials.',
      ['MOJO_SESSION_ID', 'MOJO_MCP_ACCESS_TOKEN'],
    ))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/sync-mojo-calls') as never)
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'credentials_missing',
      missing: ['MOJO_SESSION_ID', 'MOJO_MCP_ACCESS_TOKEN'],
    })
  })
})
