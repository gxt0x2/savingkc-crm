import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const commandBar = readFileSync('src/components/dialer/dialer-session-command.tsx', 'utf8')
const activeCall = readFileSync('src/components/telephony/dialer-call-state-cards.tsx', 'utf8')
const callRail = readFileSync('src/components/telephony/telephony-bar.tsx', 'utf8')
const sessionControls = readFileSync('src/components/telephony/workspace-session-controls.tsx', 'utf8')

describe('prospecting dialer rail consolidation', () => {
  it('shows dispositions only when the workspace actually requires an outcome', () => {
    expect(callRail).toContain('pendingSessionId && (outcomeRequired || Boolean(recoveryPending))')
  })

  it('keeps direct hang up in the active-call card instead of duplicating it in the footer', () => {
    expect(activeCall).toContain('Hang Up')
    expect(sessionControls).not.toContain('Hang up current call')
    expect(sessionControls).not.toContain("onAction('hangup')")
  })

  it('removes caller-policy duplication from the top command bar while the rail is docked', () => {
    expect(commandBar).toContain('{!props.controlsDocked ? <p')
  })
})
