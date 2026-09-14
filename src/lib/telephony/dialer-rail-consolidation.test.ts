import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const commandBar = readFileSync('src/components/dialer/dialer-session-command.tsx', 'utf8')
const activeCall = readFileSync('src/components/telephony/dialer-call-state-cards.tsx', 'utf8')
const callRail = readFileSync('src/components/telephony/telephony-bar.tsx', 'utf8')
const sessionControls = readFileSync('src/components/telephony/workspace-session-controls.tsx', 'utf8')

describe('prospecting dialer rail consolidation', () => {
  it('keeps the disposition choices visible in the persistent workspace rail', () => {
    expect(callRail).toContain('pendingSessionId ? <WorkspaceDispositionControls')
    expect(callRail).toContain('outcomeRequired={outcomeRequired || Boolean(recoveryPending)}')
  })

  it('keeps direct hang up in the active-call card and the persistent footer', () => {
    expect(activeCall).toContain('Hang Up')
    expect(sessionControls).toContain("onAction('hangup')")
    expect(sessionControls).toContain('Hang up')
  })

  it('keeps the top command bar limited to status, list, current, and progress', () => {
    expect(commandBar).toContain("['Status', statusValue")
    expect(commandBar).toContain("['List', props.queueLabel")
    expect(commandBar).toContain("['Current', props.currentLabel")
    expect(commandBar).toContain("['Progress', `${props.currentIndex + 1} / ${props.queueSize}`")
  })
})
