import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueuePpcConversion: vi.fn(),
  from: vi.fn(),
  getLeadQualificationStatus: vi.fn(),
}))

vi.mock('@/lib/ppc/conversion-outbox', () => ({
  enqueuePpcConversion: mocks.enqueuePpcConversion,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from: mocks.from,
  },
}))

vi.mock('@/lib/qualification-policy', () => ({
  getLeadQualificationStatus: mocks.getLeadQualificationStatus,
}))

import { queuePpcQualifiedLeadConversion } from './qualified-lead-conversion'

function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

describe('queuePpcQualifiedLeadConversion', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLeadQualificationStatus.mockResolvedValue({
      qualified: true,
      pillars: { TIMELINE: true, CONDITION: true, MOTIVATION: true, PRICE: true },
      missing: [],
    })
  })

  it('does not export a qualified conversion when the qualification evidence is incomplete', async () => {
    mocks.getLeadQualificationStatus.mockResolvedValue({
      qualified: false,
      pillars: { TIMELINE: true, CONDITION: true, MOTIVATION: false, PRICE: false },
      missing: ['MOTIVATION', 'PRICE'],
    })

    const result = await queuePpcQualifiedLeadConversion({
      leadId: 'lead-unqualified',
      toStation: 'qualified',
      changedBy: 'test',
    })

    expect(result).toEqual({ queued: false, reason: 'qualification_incomplete:MOTIVATION,PRICE' })
    expect(mocks.enqueuePpcConversion).not.toHaveBeenCalled()
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

  it('falls back to lead phone/email identifiers when no click id or submit outbox exists', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'leads') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: 'lead-call-1',
                  source: 'google_ads_phone',
                  station: 'new',
                  phone: '(816) 555-1212',
                  email: null,
                },
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
                      id: 'manifest-call-1',
                      manifest: {
                        acquisition: {
                          source: 'google_ads_phone',
                          channel: 'google-ads',
                          attribution: {
                            traffic_source: 'google_ads',
                            campaign: 'Search 2026',
                          },
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
                  data: [],
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
      leadId: 'lead-call-1',
      toStation: 'qualified',
      fromStation: 'new',
      changedBy: 'test',
    })

    expect(result).toEqual({ queued: true, reason: 'queued' })
    expect(mocks.enqueuePpcConversion).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'qualified_lead',
      attribution: expect.objectContaining({
        traffic_source: 'google_ads',
        campaign: 'Search 2026',
      }),
      payload: expect.objectContaining({
        user_identifiers: [
          {
            userIdentifierSource: 'FIRST_PARTY',
            hashedPhoneNumber: sha256Hex('+18165551212'),
          },
        ],
      }),
    }))
  })
})
