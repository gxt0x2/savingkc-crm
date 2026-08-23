import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ table: '', row: null as Record<string, unknown> | null }))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from(table: string) {
      mocks.table = table
      return {
        select() {
          return {
            eq() {
              return { async maybeSingle() { return { data: mocks.row, error: null } } }
            },
          }
        },
      }
    },
  },
}))

import { resolveCallLogContext } from './call-log-context'

describe('call log server context', () => {
  beforeEach(() => { mocks.row = null })

  it('binds a lead call to the stored primary phone', async () => {
    mocks.row = { id: 'lead-1', full_name: 'Seller', phone: '(816) 555-0100' }
    await expect(resolveCallLogContext({
      phone: '+18165550100', leadId: 'lead-1', prospectPhoneId: null,
    })).resolves.toMatchObject({ leadId: 'lead-1', leadName: 'Seller', heir: null })
    expect(mocks.table).toBe('leads')
  })

  it('rejects a client phone that does not match the selected lead', async () => {
    mocks.row = { id: 'lead-1', full_name: 'Seller', phone: '+18165550199' }
    await expect(resolveCallLogContext({
      phone: '+18165550100', leadId: 'lead-1', prospectPhoneId: null,
    })).rejects.toThrow('does not match')
  })

  it('derives heir and lead identity from the prospect phone relationship', async () => {
    mocks.row = {
      id: 'phone-1', phone: '8165550100', contact_name: 'Jamie', relationship: 'child',
      prospects: { lead_id: 'lead-1', owner_1: 'Original Owner' },
    }
    await expect(resolveCallLogContext({
      phone: '+18165550100', leadId: 'lead-1', prospectPhoneId: 'phone-1',
    })).resolves.toMatchObject({
      leadId: 'lead-1',
      heir: { name: 'Jamie', prospectPhoneId: 'phone-1' },
    })
  })
})
