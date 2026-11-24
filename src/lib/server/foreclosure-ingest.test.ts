import { beforeEach, describe, expect, it, vi } from 'vitest'

const from = vi.hoisted(() => vi.fn())
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from } }))

import { setForeclosureIngestControl } from './foreclosure-ingest'

const actor = { email: 'reviewer@example.com', name: 'Reviewer' }
const writes: unknown[] = []

function queryResult() {
  const promise = Promise.resolve({ data: { paused: true, updated_since: null }, error: null })
  const builder = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return promise.then.bind(promise)
      if (prop === 'upsert') {
        return (payload: unknown) => {
          writes.push(payload)
          return builder
        }
      }
      return () => builder
    },
  })
  return builder
}

describe('foreclosure ingest control service area', () => {
  beforeEach(() => {
    writes.length = 0
    from.mockReset()
    from.mockImplementation(() => queryResult())
  })

  it.each([
    ['Cass County', 'outside_service_area'],
    ['Leavenworth', 'outside_service_area'],
    ['Leavenworth County', 'outside_service_area'],
    ['Jackson/Cass', 'outside_service_area'],
    ['Cass County (near Jackson)', 'outside_service_area'],
    ['Johnson County, MO', 'outside_service_area'],
    ['Jackson County, KS', 'outside_service_area'],
    ['', 'invalid_ingest'],
    ['   ', 'invalid_ingest'],
    ['unknown', 'invalid_ingest'],
    ['Unknown County', 'invalid_ingest'],
  ] as const)('does not save %s', async (county, code) => {
    await expect(setForeclosureIngestControl(actor, {
      county,
      noticeType: 'lis_pendens',
      paused: false,
    })).rejects.toMatchObject({ code })
    expect(from).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('does not save a county whose state disagrees', async () => {
    await expect(setForeclosureIngestControl(actor, {
      county: 'Johnson County',
      state: 'MO',
      noticeType: 'lis_pendens',
      paused: false,
    })).rejects.toMatchObject({ code: 'outside_service_area' })
    await expect(setForeclosureIngestControl(actor, {
      county: 'Jackson County',
      state: 'KS',
      noticeType: 'lis_pendens',
      paused: false,
    })).rejects.toMatchObject({ code: 'outside_service_area' })
    expect(from).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  it('saves Jackson County, JOHNSON, and Wyandotte Co. inside the service area', async () => {
    await expect(setForeclosureIngestControl(actor, {
      county: 'Jackson County',
      state: 'MO',
      noticeType: 'lis_pendens',
      paused: true,
    })).resolves.toMatchObject({ county: 'jackson', noticeType: 'lis_pendens', paused: true })
    await expect(setForeclosureIngestControl(actor, {
      county: 'JOHNSON',
      state: 'KS',
      noticeType: 'lis_pendens',
      paused: false,
    })).resolves.toMatchObject({ county: 'johnson', noticeType: 'lis_pendens', paused: false })
    await expect(setForeclosureIngestControl(actor, {
      county: 'Wyandotte Co.',
      noticeType: 'lis_pendens',
      paused: true,
    })).resolves.toMatchObject({ county: 'wyandotte', noticeType: 'lis_pendens', paused: true })
    await expect(setForeclosureIngestControl(actor, {
      county: 'Johnson County, KS',
      noticeType: 'lis_pendens',
      paused: false,
    })).resolves.toMatchObject({ county: 'johnson', noticeType: 'lis_pendens', paused: false })
    expect(writes).toEqual([
      expect.objectContaining({ county: 'jackson', notice_type: 'lis_pendens' }),
      expect.objectContaining({ county: 'johnson', notice_type: 'lis_pendens' }),
      expect.objectContaining({ county: 'wyandotte', notice_type: 'lis_pendens' }),
      expect.objectContaining({ county: 'johnson', notice_type: 'lis_pendens' }),
    ])
  })
})
