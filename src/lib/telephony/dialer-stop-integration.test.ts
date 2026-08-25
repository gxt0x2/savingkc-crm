import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const callingFloor = readFileSync('src/components/prospecting/prospecting-calling-floor.tsx', 'utf8')
const callController = readFileSync('src/components/telephony/telephony-bar.tsx', 'utf8')

describe('dialer stop lifecycle integration', () => {
  it('persists the operator command before asking the call controller to disconnect', () => {
    expect(callingFloor).toContain("transitionCurrentSession('request_stop')")
    expect(callingFloor).toContain("new CustomEvent('dialer-session-stop-requested', { detail: session })")
  })

  it('suppresses automatic dialing and number advancement while a stop is pending', () => {
    expect(callController).toContain('pendingAutoDialRef.current = false')
    expect(callController).toContain("postDisposition === 'stop_session'")
    expect(callController).toContain("transitionDurableDialerSession(durableSessionId, 'stop')")
  })

  it('recovers a persisted stop request after a refresh', () => {
    expect(callController).toContain('session.stopRequestedAt ? session.id : null')
    expect(callController).toContain("transitionDurableDialerSession(session.id, 'stop')")
  })
})
