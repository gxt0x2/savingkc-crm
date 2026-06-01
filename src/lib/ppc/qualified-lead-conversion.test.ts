import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueuePpcConversion: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/ppc/conversion-outbox', () => ({
  enqueuePpcConversion: mocks.enqueuePpcConversion,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: mocks.from,
  },
}))

import { queuePpcQualifiedLeadConversion } from './qualified-lead-conversion'

describe('queuePpcQualifiedLeadConversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('carries stored user identifiers from lead submit to the qualified lead conversion', async () => {
    const userIdentifiers = [
      {
        userIdentifierSource: 'FIRST_PARTY' as const,
        hashedEmail: 'a'.repeat(64),
      },
    ]

    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: 'lead-1', source: 'ppc-landing', station: 'new' },
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === 'manifests') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: async () => ({
                    data: {
                      id: 'manifest-1',
                      manifest: {
                        acquisition: {
                          source: 'ppc-landing',
                          channel: 'google-ads',
                          attribution: { gclid: 'manifest-click' },
                        },
                      },
                    },
                    error: null,
                  }),
                }),
              }),
            }),
          }),
        }
      }

      if (table === 'ppc_conversion_outbox') {
        return {
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: async () => ({
                  data: [
                    {
                      click_id: null,
                      click_id_type: null,
                      attribution: {},
                      payload: { source: 'call_connected_5m' },
                    },
                    {
                      click_id: 'submit-click',
                      click_id_type: 'gclid',
                      attribution: { gclid: 'submit-click' },
                      payload: { user_identifiers: userIdentifiers },
                    },
                  ],
                  error: null,
                }),
              }),
            }),
          }),
        }
      }

      throw new Error(`Unexpected table ${table}`)
    })

    mocks.enqueuePpcConversion.mockResolvedValue({ queued: true, row: {} })

    const result = await queuePpcQualifiedLeadConversion({
      leadId: 'lead-1',
      toStation: 'qualified',
      fromStation: 'new',
      changedBy: 'test',
    })

    expect(result).toEqual({ queued: true, reason: 'queued' })
    expect(mocks.enqueuePpcConversion).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'qualified_lead',
      payload: expect.objectContaining({
        user_identifiers: userIdentifiers,
      }),
    }))
  })
})
