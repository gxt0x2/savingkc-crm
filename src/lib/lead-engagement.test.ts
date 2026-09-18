import { describe, expect, it } from 'vitest'

import { assessFavoriteOrFool } from './lead-engagement'

describe('Favorite or Fool assessment', () => {
  it('does not manufacture a verdict for a New lead with no appointment', () => {
    expect(assessFavoriteOrFool({ station: 'new', appointment: null, activities: [] })).toMatchObject({
      verdict: 'unclear',
      label: 'Still unclear',
    })
  })

  it('explains a favorite signal from recorded seller behavior', () => {
    const result = assessFavoriteOrFool({
      station: 'appointment_set',
      appointment: { scheduledAt: '2026-09-18T15:00:00.000Z' },
      activities: [{
        activity_type: 'sms',
        description: 'Seller confirmed the time',
        metadata: { direction: 'inbound' },
        created_at: '2026-09-15T12:00:00.000Z',
      }],
    })

    expect(result.verdict).toBe('favorite')
    expect(result.favoriteSignals).toContain('Seller committed time to an appointment.')
    expect(result.favoriteSignals).toContain('1 inbound seller response recorded.')
  })

  it('labels explicit competitive shopping as risk instead of a fact', () => {
    const result = assessFavoriteOrFool({
      station: 'contacted',
      notes: 'Seller is comparing offers from another buyer.',
      appointment: null,
      activities: [],
    })

    expect(result).toMatchObject({ verdict: 'fool', label: 'Fool risk is high' })
    expect(result.foolSignals[0]).toContain('competing buyers or offers')
  })

  it('keeps an appointment-only lead as leaning favorite until preference evidence appears', () => {
    expect(assessFavoriteOrFool({
      station: 'new',
      appointment: { scheduledAt: '2026-09-18T15:00:00.000Z' },
      activities: [],
    })).toMatchObject({ verdict: 'likely_favorite', label: 'Leaning favorite' })
  })

  it('reads nested call-analysis signals from canonical activity metadata', () => {
    const result = assessFavoriteOrFool({
      station: 'contacted',
      appointment: null,
      activities: [{
        activity_type: 'call',
        description: 'Seller conversation',
        metadata: { analysis: { rapport: 'strong rapport', concessionSignals: ['Flexible closing'] } },
        created_at: '2026-09-15T12:00:00.000Z',
      }],
    })

    expect(result.favoriteSignals).toContain('Conversation evidence shows rapport or movement toward agreement.')
  })
})
