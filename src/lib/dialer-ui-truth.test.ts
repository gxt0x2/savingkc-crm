import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const compatibilityPage = readFileSync('src/app/(app)/dialer/page.tsx', 'utf8')
const prospectingPage = readFileSync('src/app/(app)/prospecting/page.tsx', 'utf8')
const callingFloor = readFileSync('src/components/prospecting/prospecting-calling-floor.tsx', 'utf8')

describe('Prospecting calling-floor truth contract', () => {
  it('keeps the old Dialer URL as redirect-only compatibility', () => {
    expect(compatibilityPage).toContain("redirect(query ? `/prospecting?${query}` : '/prospecting')")
    expect(compatibilityPage).not.toContain('DialerOverview')
    expect(compatibilityPage).not.toContain('DialerHome')
    expect(existsSync('src/components/dialer/dialer-route-gate.tsx')).toBe(false)
    expect(existsSync('src/components/dialer/dialer-session-history.tsx')).toBe(false)
  })

  it('owns the live durable session inside Prospecting', () => {
    expect(prospectingPage).toContain('ProspectingCallingFloor')
    expect(callingFloor).toContain('loadDurableDialerSession')
    expect(callingFloor).toContain('transitionDurableDialerSession')
    expect(callingFloor).toContain('durableSession?.callerId || requestedCallerId')
    expect(callingFloor).toContain('<DialerSessionCommand')
    expect(callingFloor).toContain('<HeirsSection')
    expect(callingFloor).toContain('Safety checked before every dial')
  })

  it('does not carry the obsolete queue-builder dashboard into Prospecting', () => {
    for (const obsolete of [
      'function DialerHome',
      'function DialerOverview',
      'QUEUE_PRESETS',
      'Build custom queue',
      'Single-line dialing',
      'Start single-line session',
      'saved-list-meta',
    ]) expect(callingFloor).not.toContain(obsolete)
  })
})
