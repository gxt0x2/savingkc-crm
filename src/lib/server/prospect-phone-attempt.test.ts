import { describe, expect, it, vi } from 'vitest'
import { markLeadProspectPhoneAttempted, type ProspectPhoneAttemptDb } from './prospect-phone-attempt'

function fakeDb(opts: { prospects?: Array<{ id: string }>; updated?: Array<{ id: string }>; updateError?: string }) {
  const calls: { patch?: Record<string, unknown>; prospectIds?: string[]; phone?: string } = {}
  const db = {
    from(table: string) {
      if (table === 'prospects') {
        return { select: () => ({ eq: async () => ({ data: opts.prospects ?? [], error: null }) }) }
      }
      return {
        update(patch: Record<string, unknown>) {
          calls.patch = patch
          return {
            in(_c: string, values: string[]) {
              calls.prospectIds = values
              return {
                eq(_c2: string, value: string) {
                  calls.phone = value
                  return {
                    select: async () => opts.updateError
                      ? { data: null, error: { message: opts.updateError } }
                      : { data: opts.updated ?? [], error: null },
                  }
                },
              }
            },
          }
        },
      }
    },
  } as unknown as ProspectPhoneAttemptDb
  return { db, calls }
}

describe('markLeadProspectPhoneAttempted', () => {
  it('flips attempted=true on no_answer for the matching prospect phone (Pelton gap)', async () => {
    const { db, calls } = fakeDb({ prospects: [{ id: 'p1' }], updated: [{ id: 'pp1' }] })
    const ids = await markLeadProspectPhoneAttempted(db, {
      leadId: 'lead-1', phone: '(816) 555-0570', disposition: 'no_answer', actorName: 'Casey', now: '2026-11-06T00:00:00.000Z',
    })
    expect(ids).toEqual(['pp1'])
    expect(calls.phone).toBe('+18165550570')
    expect(calls.prospectIds).toEqual(['p1'])
    expect(calls.patch).toEqual({
      attempted: true, last_disposition: 'no_answer', last_attempt_at: '2026-11-06T00:00:00.000Z', last_attempt_by: 'Casey',
    })
  })

  it('does nothing without a valid phone or a linked prospect', async () => {
    const a = fakeDb({ prospects: [{ id: 'p1' }] })
    expect(await markLeadProspectPhoneAttempted(a.db, { leadId: 'l', phone: null, disposition: 'no_answer', actorName: 'x' })).toEqual([])
    expect(a.calls.patch).toBeUndefined()
    const b = fakeDb({ prospects: [] })
    expect(await markLeadProspectPhoneAttempted(b.db, { leadId: 'l', phone: '8165550570', disposition: 'no_answer', actorName: 'x' })).toEqual([])
    expect(b.calls.patch).toBeUndefined()
  })

  it('never throws when the update fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { db } = fakeDb({ prospects: [{ id: 'p1' }], updateError: 'boom' })
    await expect(markLeadProspectPhoneAttempted(db, { leadId: 'l', phone: '8165550570', disposition: 'busy', actorName: 'x' })).resolves.toEqual([])
    spy.mockRestore()
  })
})
