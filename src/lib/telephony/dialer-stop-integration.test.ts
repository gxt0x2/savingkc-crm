import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const callingFloor = readFileSync('src/components/prospecting/prospecting-calling-floor.tsx', 'utf8')
const callController = readFileSync('src/components/telephony/telephony-bar.tsx', 'utf8')
const countdown = readFileSync('src/components/telephony/use-dialer-start-countdown.ts', 'utf8')
const controlLoss = readFileSync('src/components/telephony/use-dialer-control-loss.ts', 'utf8')
const heirsSection = readFileSync('src/components/leads/heirs-section.tsx', 'utf8')
const smsCompose = readFileSync('src/components/leads/sms-compose-modal.tsx', 'utf8')
const smsThread = readFileSync('src/components/leads/sms-thread-panel.tsx', 'utf8')
const callingContext = readFileSync('src/components/prospecting/prospecting-calling-context-rail.tsx', 'utf8')
const lifecycleClient = readFileSync('src/lib/crm-lifecycle-client.ts', 'utf8')
const callIntent = readFileSync('src/lib/telephony/dialer-call-intent.ts', 'utf8')

describe('dialer stop lifecycle integration', () => {
  it('persists the operator command before asking the call controller to disconnect', () => {
    expect(callingFloor).toContain("transitionCurrentSession('request_stop')")
    expect(callingFloor).toContain("new CustomEvent('dialer-session-stop-requested', { detail: session })")
  })

  it('suppresses automatic dialing and number advancement while a stop is pending', () => {
    expect(callController).toContain('cancelAutoStart()')
    expect(callController).toContain("postDisposition === 'stop_session'")
    expect(callController).toContain("transitionDurableDialerSession(durableSessionId, 'stop')")
  })

  it('holds the first automatic dial for fifteen seconds and lets pause cancel it first', () => {
    expect(countdown).toContain('FIRST_DIAL_COUNTDOWN_SECONDS = 15')
    expect(callController).toContain('autoStartCountdownSeconds !== null && autoStartCountdownSeconds > 0')
    expect(callController).toContain("detail: { action: 'pause' }")
    expect(callController).toContain('finishAutoStart()')
  })

  it('recovers a persisted stop request after a refresh', () => {
    expect(callController).toContain('session.stopRequestedAt ? session.id : null')
    expect(callController).toContain("transitionDurableDialerSession(session.id, 'stop')")
  })

  it('cancels queued dialing and disconnects the displaced browser after matching session control is lost', () => {
    expect(countdown).toContain("window.addEventListener('dialer-control-lost', onControlLost)")
    expect(controlLoss).toContain("window.addEventListener('dialer-control-lost', onControlLost)")
    expect(controlLoss).toContain('lostSessionId !== sessionId')
    expect(controlLoss).toContain('cancelAutoStart()')
    expect(controlLoss).toContain('activeCall?.disconnect()')
    expect(controlLoss).toContain('controlLossRevisions.set(sessionId')
    expect(controlLoss).toContain('endQueue()')
    expect(callController).toContain('dialerControlChanged(pendingSessionId, controlLossRevisionAtStart)')
  })

  it('keeps ordinary progression blocked until the CRM disposition is stored', () => {
    const start = callController.indexOf('async function handleDisposition')
    const end = callController.indexOf('async function chooseWorkspaceDisposition', start)
    const dispositionFlow = callController.slice(start, end)
    const durableDisposition = dispositionFlow.indexOf("action: 'disposition'")

    expect(durableDisposition).toBeGreaterThan(dispositionFlow.indexOf('await saveManualCallDisposition'))
    expect(durableDisposition).toBeGreaterThan(dispositionFlow.indexOf("await fetch('/api/heirs/attempt'"))
    expect(durableDisposition).toBeGreaterThan(dispositionFlow.indexOf('await fetch(`/api/leads/${dispositionLeadId}/disposition`'))
  })

  it('persists dialing before provider connect so a leftover authorization is pre-call only', () => {
    const makeCallStart = callController.indexOf('async function makeCall')
    const makeCallEnd = callController.indexOf('makeCallRef.current = makeCall', makeCallStart)
    const makeCall = callController.slice(makeCallStart, makeCallEnd)
    const authorization = makeCall.indexOf('await requestDialerCallIntent({')
    const dialingTransition = makeCall.indexOf("action: 'started'", authorization)
    const providerConnect = makeCall.indexOf('await deviceRef.current.connect({', dialingTransition)

    expect(authorization).toBeGreaterThan(-1)
    expect(dialingTransition).toBeGreaterThan(authorization)
    expect(providerConnect).toBeGreaterThan(dialingTransition)
    expect(callIntent).toContain('const INTENT_TTL_SECONDS = 90')
  })

  it('leases every CRM write exposed by the active Prospecting session', () => {
    expect(callingFloor).toContain("withDialerSessionControlOperation(durableSessionId, 'Marking lead dead', async (controlHeaders, signal)")
    expect(callingFloor).toMatch(/withDialerSessionControlOperation\([\s\S]*transitionCurrentSession\('skip',[\s\S]*DialerOperationHoldRetainedError/)
    expect(heirsSection).toContain("withDialerSessionControlOperation(dialerSessionId, 'Syncing associated contacts', (controlHeaders, signal)")
    expect(heirsSection).toContain("withDialerSessionControlOperation(dialerSessionId, 'Updating phone verification', (controlHeaders, signal)")
    expect(heirsSection).toContain("withDialerSessionControlOperation(dialerSessionId, 'Saving contact note', (controlHeaders, signal)")
    expect(smsCompose).toContain("withDialerSessionControlOperation(dialerSessionId, 'Sending text message', (controlHeaders, signal)")
    expect(smsCompose).toContain("withDialerSessionControlOperation(dialerSessionId, 'Sending email', (controlHeaders, signal)")
    expect(smsThread).toContain("withDialerSessionControlOperation(dialerSessionId, 'Sending text message', (controlHeaders, signal)")
    expect([callingFloor, heirsSection, smsCompose, smsThread].every((source) => source.includes('signal,'))).toBe(true)
    expect(callingContext).toContain('dialerSessionId={props.durableSessionId || null}')
    expect(lifecycleClient).toContain("withDialerSessionControlOperation(input.dialerSessionId, 'Marking lead dead'")
    expect(callController).toContain('dialerSessionId: durableSessionId')
  })

  it('cannot apply a delayed Mark Dead skip to the next seller', () => {
    const markDeadStart = callingFloor.indexOf('const markLeadDead = useCallback')
    const markDeadEnd = callingFloor.indexOf('const ownerName = useMemo', markDeadStart)
    const markDeadFlow = callingFloor.slice(markDeadStart, markDeadEnd)

    expect(callingFloor).toContain('if (markDeadBusy || controlLocked) return')
    expect(callingFloor).toContain('actionPending={sessionActionPending || markDeadBusy}')
    expect(markDeadFlow).toContain('const markDeadSubjectKey = currentSubjectKey')
    expect(markDeadFlow).toContain('if (currentDialerSubjectKeyRef.current !== markDeadSubjectKey) return lifecycleResponse')
    expect(markDeadFlow.indexOf('currentDialerSubjectKeyRef.current !== markDeadSubjectKey'))
      .toBeLessThan(markDeadFlow.indexOf("transitionCurrentSession('skip'"))
  })

  it('cannot carry an SMS recipient or queue shortcut across seller dialogs', () => {
    expect(callingFloor).toContain('setSmsTarget({ ...target, leadId: currentLeadId, subjectKey: currentSubjectKey })')
    expect(callingFloor).toContain('target.subjectKey !== nextSubjectKey ? null : target')
    expect(callingFloor).toContain('currentSubjectKey === smsTarget.subjectKey')
    expect(callingFloor).toContain("target?.closest('input, textarea, select, button, a, [contenteditable=\"true\"], [role=\"dialog\"]')")
  })
})
