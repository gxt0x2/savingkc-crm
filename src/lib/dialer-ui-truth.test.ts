import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dialerPageSource = readFileSync('src/app/(app)/dialer/page.tsx', 'utf8')

describe('dialer UI truth contract', () => {
  it('presents the implemented single-line session without unsupported controls', () => {
    expect(dialerPageSource).toContain('Single-line dialing')
    expect(dialerPageSource).toContain('Start single-line session')
    expect(dialerPageSource).toContain('One number at a time')

    for (const unsupportedToken of [
      'Power Dialer',
      'Click To Call',
      'Lines</span>',
      'Use Call Hammer',
      'Voicemail Call Hammer',
      'Voicemail Drop',
      'Callback Message',
      'Auto Send Email',
      'Auto Email On',
      'Redial Caller ID',
      'lineDialCount',
      'setDialMode',
    ]) {
      expect(dialerPageSource).not.toContain(unsupportedToken)
    }
  })

  it('retains saved-list URL compatibility and working ring configuration', () => {
    expect(dialerPageSource).toContain("query.set('call_hammer'")
    expect(dialerPageSource).toContain("query.set('voicemail_call_hammer'")
    expect(dialerPageSource).toContain("query.set('ring_count'")
    expect(dialerPageSource).toContain('redialCallerId')
  })
})
