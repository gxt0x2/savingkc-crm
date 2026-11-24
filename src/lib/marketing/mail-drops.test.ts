import { describe, expect, it } from 'vitest'
import { mailDropRates, mailDropUrl, parseMailDropInput, suggestMailDropCode } from './mail-drops'

describe('mail drops (G8)', () => {
  it('builds a readable code and a tagged URL', () => {
    expect(suggestMailDropCode('Jackson tax-delinquent, Nov', '2026-11-24')).toBe('jackson-tax-delinquent-nov-1124')
    expect(mailDropUrl({ code: 'jackson-tax-nov-1124', landing_path: '/what-i-owe/' }))
      .toBe('https://savingkc.com/what-i-owe/?utm_source=direct_mail&utm_medium=mail&utm_campaign=jackson-tax-nov-1124')
  })

  it('parses a drop and normalizes the response number', () => {
    const parsed = parseMailDropInput({ name: 'Clay inherited', drop_date: '2026-12-01', pieces: '1500', cost: '$825.50', response_number: '(816) 608-8770' })
    expect(parsed).toEqual({ ok: true, value: expect.objectContaining({
      code: 'clay-inherited-1201', pieces: 1500, cost: 825.5, response_number: '+18166088770', landing_path: '/',
    }) })
  })

  it('rejects missing and malformed fields', () => {
    expect(parseMailDropInput({ drop_date: '2026-12-01', pieces: 10 })).toMatchObject({ ok: false })
    expect(parseMailDropInput({ name: 'x', drop_date: 'Dec 1', pieces: 10 })).toMatchObject({ ok: false })
    expect(parseMailDropInput({ name: 'x', drop_date: '2026-12-01', pieces: 1.5 })).toMatchObject({ ok: false })
    expect(parseMailDropInput({ name: 'x', drop_date: '2026-12-01', pieces: 10, response_number: '555' })).toMatchObject({ ok: false })
    expect(parseMailDropInput({ name: 'x', drop_date: '2026-12-01', pieces: 10, landing_path: 'https://evil.example' })).toMatchObject({ ok: false })
    expect(parseMailDropInput({ name: 'x', drop_date: '2026-12-01', pieces: 10, code: 'Bad Code!' })).toMatchObject({ ok: false })
  })

  it('computes response rate and cost per lead only when it can', () => {
    expect(mailDropRates({ pieces: 1000, cost: 500, leads: 4, web_visits: 10 })).toEqual({ responseRate: 0.004, costPerLead: 125, visitRate: 0.01 })
    expect(mailDropRates({ pieces: 0, cost: null, leads: 0, web_visits: 0 })).toEqual({ responseRate: null, costPerLead: null, visitRate: null })
  })
})
