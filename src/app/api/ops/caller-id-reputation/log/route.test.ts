import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  insert: vi.fn(),
  insertSelect: vi.fn(),
  latestOrder: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (table: string) => {
      if (table === 'caller_id_reputation_log') {
        return {
          insert: (rows: unknown[]) => {
            mocks.insert(rows)
            return { select: mocks.insertSelect }
          },
        }
      }
      if (table === 'caller_id_reputation_latest') {
        return {
          select: () => ({ order: mocks.latestOrder }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  }),
}))

import { GET, POST } from './route'

function request(method: string, body?: unknown, authorization?: string) {
  return new Request('https://crm.savingkc.com/api/ops/caller-id-reputation/log', {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(authorization === undefined ? {} : { authorization }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const validRow = {
  check_slot: 'am',
  phone_e164: '(816) 555-0100',
  number_label: 'Main',
  mojo_verified: true,
  reputation_guard_status: 'clean',
  voice_integrity_attached: true,
  last_attestation: 'A',
  dials_today: 40,
  connect_rate: 0.22,
  connect_rate_5d: 0.19,
  short_call_share: 0.04,
  flag_reason: null,
  action_taken: 'none',
  action_result: 'kept',
  rotation_state: 'active',
  consecutive_clean: 3,
  fix_attempts: 0,
  decision_needed: false,
  notes: 'morning check',
  raw: { source: 'manual' },
}

describe('/api/ops/caller-id-reputation/log', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CALLER_ID_LOG_SECRET', 'log-secret')
    mocks.insertSelect.mockResolvedValue({ data: [{ id: 'row-1' }, { id: 'row-2' }], error: null })
    mocks.latestOrder.mockResolvedValue({ data: [], error: null })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns 503 when the log secret is unset', async () => {
    vi.stubEnv('CALLER_ID_LOG_SECRET', '   ')
    const post = await POST(request('POST', { rows: [validRow] }, 'Bearer log-secret'))
    const get = await GET(request('GET', undefined, 'Bearer log-secret'))

    expect(post.status).toBe(503)
    expect(get.status).toBe(503)
    await expect(post.json()).resolves.toEqual({ error: 'Caller ID reputation log is not configured' })
    expect(post.headers.get('cache-control')).toContain('no-store')
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.latestOrder).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['wrong', 'Bearer other-secret'],
  ])('rejects a %s bearer before reading or writing', async (_label, authorization) => {
    const post = await POST(request('POST', { rows: [validRow] }, authorization))
    const get = await GET(request('GET', undefined, authorization))

    expect(post.status).toBe(401)
    expect(get.status).toBe(401)
    await expect(post.json()).resolves.toEqual({ error: 'Unauthorized' })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.latestOrder).not.toHaveBeenCalled()
  })

  it('inserts a normalized batch and returns the new ids', async () => {
    const response = await POST(request('POST', {
      rows: [
        validRow,
        { phone_e164: '+18165550101', check_slot: 'pm', rotation_state: 'resting', decision_needed: true },
      ],
    }, 'bearer log-secret'))

    expect(response.status).toBe(201)
    await expect(response.json()).resolves.toEqual({ ok: true, inserted: 2, ids: ['row-1', 'row-2'] })
    expect(mocks.insert).toHaveBeenCalledOnce()
    const inserted = mocks.insert.mock.calls[0][0]
    expect(inserted).toHaveLength(2)
    expect(inserted[0]).toMatchObject({
      phone_e164: '+18165550100',
      check_slot: 'am',
      number_label: 'Main',
      mojo_verified: true,
      last_attestation: 'A',
      rotation_state: 'active',
      decision_needed: false,
      raw: { source: 'manual' },
    })
    expect(inserted[1]).toMatchObject({
      phone_e164: '+18165550101',
      check_slot: 'pm',
      rotation_state: 'resting',
      decision_needed: true,
    })
    expect(inserted[0].checked_at).toEqual(expect.any(String))
  })

  it('rejects an invalid row without inserting', async () => {
    const response = await POST(request('POST', {
      rows: [{ ...validRow, last_attestation: 'D' }],
    }, 'Bearer log-secret'))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ error: 'Invalid caller ID reputation log' })
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('returns the latest row per number', async () => {
    mocks.latestOrder.mockResolvedValue({
      data: [
        { id: '00000000-0000-4000-8000-000000000001', phone_e164: '+18165550100', checked_at: '2026-11-14T15:00:00.000Z', rotation_state: 'resting' },
        { id: '00000000-0000-4000-8000-000000000002', phone_e164: '+18165550100', checked_at: '2026-11-14T16:00:00.000Z', rotation_state: 'active' },
        { id: '00000000-0000-4000-8000-000000000004', phone_e164: '+18165550102', checked_at: '2026-11-14T12:00:00.000Z', rotation_state: 'resting' },
        { id: '00000000-0000-4000-8000-000000000005', phone_e164: '+18165550102', checked_at: '2026-11-14T12:00:00.000Z', rotation_state: 'active' },
        { id: '00000000-0000-4000-8000-000000000003', phone_e164: '+18165550101', checked_at: '2026-11-14T11:00:00.000Z', rotation_state: 'active' },
      ],
      error: null,
    })

    const response = await GET(request('GET', undefined, 'Bearer log-secret'))

    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toEqual({
      ok: true,
      numbers: [
        { id: '00000000-0000-4000-8000-000000000002', phone_e164: '+18165550100', checked_at: '2026-11-14T16:00:00.000Z', rotation_state: 'active' },
        { id: '00000000-0000-4000-8000-000000000003', phone_e164: '+18165550101', checked_at: '2026-11-14T11:00:00.000Z', rotation_state: 'active' },
        { id: '00000000-0000-4000-8000-000000000005', phone_e164: '+18165550102', checked_at: '2026-11-14T12:00:00.000Z', rotation_state: 'active' },
      ],
    })
    expect(mocks.insert).not.toHaveBeenCalled()
    expect(mocks.latestOrder).toHaveBeenCalledWith('checked_at', { ascending: false })
  })
})
