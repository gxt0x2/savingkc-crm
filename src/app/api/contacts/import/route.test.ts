import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  duplicateRows: [] as Array<{ normalized_value: string }>,
  duplicateError: null as { message: string } | null,
  inserted: [{ id: 'lead-1' }] as Array<{ id: string }>,
  insertError: null as { message: string } | null,
  activityError: null as { message: string } | null,
  leadPayloads: [] as unknown[],
  activityPayloads: [] as unknown[],
  dbFrom: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from(table: string) {
      mocks.dbFrom(table)
      if (table === 'crm_contact_methods') {
        return {
          select() {
            return {
              eq() {
                return {
                  async in() {
                    return { data: mocks.duplicateRows, error: mocks.duplicateError }
                  },
                }
              },
            }
          },
        }
      }
      if (table === 'leads') {
        return {
          insert(payload: unknown) {
            mocks.leadPayloads.push(payload)
            return {
              async select() {
                return { data: mocks.inserted, error: mocks.insertError }
              },
            }
          },
        }
      }
      return {
        async insert(payload: unknown) {
          mocks.activityPayloads.push(payload)
          return { error: mocks.activityError }
        },
      }
    },
  }),
}))

import { POST } from './route'

function request(rows: unknown[]) {
  return new NextRequest('https://crm.savingkc.com/api/contacts/import', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rows }),
  })
}

describe('atomic prospect import', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.duplicateRows = []
    mocks.duplicateError = null
    mocks.inserted = [{ id: 'lead-1' }]
    mocks.insertError = null
    mocks.activityError = null
    mocks.leadPayloads.length = 0
    mocks.activityPayloads.length = 0
  })

  it('rejects anonymous imports before parsing or database access', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request([{ name: 'Seller', phone: '8165550100' }])
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.dbFrom).not.toHaveBeenCalled()
  })

  it('rejects invalid CSV rows before database access', async () => {
    const response = await POST(request([{ name: 'Seller', phone: 'bad' }]))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ row: 2 })
    expect(mocks.dbFrom).not.toHaveBeenCalled()
  })

  it('blocks an existing canonical phone before inserting any row', async () => {
    mocks.duplicateRows = [{ normalized_value: '+18165550100' }]

    const response = await POST(request([{ name: 'Seller', phone: '8165550100' }]))

    expect(response.status).toBe(409)
    expect(mocks.leadPayloads).toHaveLength(0)
    expect(mocks.activityPayloads).toHaveLength(0)
  })

  it('inserts the validated prospect batch once and attributes its audit evidence', async () => {
    const response = await POST(request([{ name: 'Seller', phone: '8165550100' }]))

    expect(response.status).toBe(201)
    expect(mocks.leadPayloads).toEqual([[expect.objectContaining({
      phone: '+18165550100',
      station: 'new',
      classification: null,
      pipeline_intent_source: null,
    })]])
    expect(mocks.activityPayloads).toEqual([[expect.objectContaining({
      lead_id: 'lead-1',
      agent: 'Casey',
      metadata: expect.objectContaining({ source: 'contact_csv_import' }),
    })]])
  })

  it('does not write audit rows when the atomic lead insert fails', async () => {
    mocks.inserted = []
    mocks.insertError = { message: 'insert failed' }

    const response = await POST(request([{ name: 'Seller', phone: '8165550100' }]))

    expect(response.status).toBe(500)
    expect(mocks.activityPayloads).toHaveLength(0)
  })
})
