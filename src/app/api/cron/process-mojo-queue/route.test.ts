import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminOrSecret: vi.fn(),
  runWorker: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.requireAdminOrSecret }))
vi.mock('@/lib/server/mojo-call-import', () => ({ runCanonicalMojoQueueWorker: mocks.runWorker }))

import { GET } from './route'

describe('/api/cron/process-mojo-queue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminOrSecret.mockResolvedValue(null)
    mocks.runWorker.mockResolvedValue({ claimed: 0, completed: 0, pending: 0, deadLetter: 0, failed: 0, results: [] })
  })

  it('rejects untrusted callers before claiming work', async () => {
    mocks.requireAdminOrSecret.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/process-mojo-queue') as never)
    expect(response.status).toBe(401)
    expect(mocks.runWorker).not.toHaveBeenCalled()
  })

  it('runs one bounded canonical batch with no-store', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/process-mojo-queue?limit=7') as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(mocks.runWorker).toHaveBeenCalledWith({ limit: 7 })
  })
})
