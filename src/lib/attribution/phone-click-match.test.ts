import { describe, expect, it } from 'vitest'
import { decidePhoneClickMatch, type PhoneClickRow } from './phone-click-match'

const row = (session: string | null, extra: Partial<PhoneClickRow> = {}): PhoneClickRow => ({
  session_id: session, visitor_id: null, traffic_source: 'organic_search', utm_source: null, utm_medium: null, utm_campaign: null, gclid: null, page_path: '/', ...extra,
})

describe('phone click match', () => {
  it('needs exactly one session', () => {
    expect(decidePhoneClickMatch([]).reason).toBe('no_clicks')
    expect(decidePhoneClickMatch([row(null)]).reason).toBe('no_clicks')
    expect(decidePhoneClickMatch([row('a'), row('b')]).reason).toBe('several_sessions')
    expect(decidePhoneClickMatch([row('a'), row('a')]).reason).toBe('single_session')
  })

  it('uses tags first, then the traffic source, and never calls direct a source', () => {
    expect(decidePhoneClickMatch([row('a', { utm_source: 'facebook' })]).match?.source).toBe('facebook')
    expect(decidePhoneClickMatch([row('a')]).match?.source).toBe('organic_search')
    expect(decidePhoneClickMatch([row('a', { traffic_source: 'direct' })]).match?.source).toBeNull()
  })
})
