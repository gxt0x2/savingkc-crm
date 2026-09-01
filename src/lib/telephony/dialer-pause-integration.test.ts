import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const callingFloor = readFileSync('src/components/prospecting/prospecting-calling-floor.tsx', 'utf8')
const pauseAndLeave = readFileSync('src/components/prospecting/use-dialer-pause-and-leave.ts', 'utf8')
const callController = readFileSync('src/components/telephony/telephony-bar.tsx', 'utf8')
const sessionControl = readFileSync('src/components/prospecting/use-prospecting-session-control.ts', 'utf8')

describe('dialer pause lifecycle integration', () => {
  it('uses the call-safe pause request instead of the strict session transition', () => {
    expect(sessionControl).toContain('requestPauseDurableDialerSession(sessionId')
    expect(callingFloor).toContain('dispatchDialerPauseRequested(result, false)')
    expect(callingFloor).not.toContain("transitionCurrentSession('pause')")
  })

  it('keeps pause-and-stay distinct from pause-and-leave', () => {
    expect(pauseAndLeave).toContain('dispatchDialerPauseRequested(result, true)')
    expect(pauseAndLeave).toContain('detail.leaveAfterPause === true')
    expect(callController).toContain('pauseLeaveAfterOutcomeRef.current = detail.leaveAfterPause === true')
  })

  it('carries leave intent through disposition without advancing the queue', () => {
    expect(callController).toContain("postDisposition === 'pause_session'")
    expect(callController).toContain('const leaveAfterPause = pauseLeaveAfterOutcomeRef.current')
    expect(callController).toContain('detail: { sessionId: durableSessionId, leaveAfterPause }')
  })

  it('cancels an authorized attempt when pause or stop wins before provider connect', () => {
    const makeCallStart = callController.indexOf('async function makeCall')
    const makeCallEnd = callController.indexOf('makeCallRef.current = makeCall', makeCallStart)
    const makeCall = callController.slice(makeCallStart, makeCallEnd)
    const started = makeCall.indexOf("action: 'started'")
    const pauseGuard = makeCall.indexOf('const pauseBeforeProviderConnect = dialerPauseIsPending(', started)
    const cancellation = makeCall.indexOf("action: 'cancelled'", pauseGuard)
    const providerConnect = makeCall.indexOf('await deviceRef.current.connect({', cancellation)
    const lateStopGuard = makeCall.lastIndexOf('dialerStopIsPending(activeSessionIdRef.current, stopRequestedSessionIdRef.current)')
    const latePauseGuard = makeCall.indexOf('dialerPauseIsPending(activeSessionIdRef.current, pausedSessionIdRef.current)', lateStopGuard)
    const lateDisconnect = makeCall.indexOf('call.disconnect()', latePauseGuard)

    expect(pauseGuard).toBeGreaterThan(started)
    expect(cancellation).toBeGreaterThan(pauseGuard)
    expect(providerConnect).toBeGreaterThan(cancellation)
    expect(makeCall).toContain('const stopBeforeProviderConnect = dialerStopIsPending(')
    expect(makeCall).toContain('clearDispositionRequirement()')
    expect(makeCall).toContain("new CustomEvent('dialer-session-pause-completed'")
    expect(latePauseGuard).toBeGreaterThan(lateStopGuard)
    expect(lateDisconnect).toBeGreaterThan(latePauseGuard)
  })
})
