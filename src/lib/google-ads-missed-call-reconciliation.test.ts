import { describe, expect, it } from 'vitest'
import { googleAdsCallSidActivityOrFilter } from './google-ads-missed-call-reconciliation'

describe('Google Ads missed-call reconciliation', () => {
  it('uses one call SID filter for detected and repaired call activities', () => {
    expect(googleAdsCallSidActivityOrFilter('CA123')).toBe([
      'metadata->>callSid.eq.CA123',
      'metadata->>CallSid.eq.CA123',
      'metadata->>parent_call_sid.eq.CA123',
      'metadata->>parentCallSid.eq.CA123',
      'metadata->>call_sid.eq.CA123',
    ].join(','))
  })
})
