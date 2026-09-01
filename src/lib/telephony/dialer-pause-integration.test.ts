import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const callingFloor = readFileSync('src/components/prospecting/prospecting-calling-floor.tsx', 'utf8')
const pauseAndLeave = readFileSync('src/components/prospecting/use-dialer-pause-and-leave.ts', 'utf8')
const callController = readFileSync('src/components/telephony/telephony-bar.tsx', 'utf8')

describe('dialer pause lifecycle integration', () => {
  it('uses the call-safe pause request instead of the strict session transition', () => {
    expect(callingFloor).toContain('requestPauseDurableDialerSession(durableSessionId')
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
})
