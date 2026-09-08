import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const compatibilityPage = readFileSync('src/app/(app)/dialer/page.tsx', 'utf8')
const prospectingPage = readFileSync('src/app/(app)/prospecting/page.tsx', 'utf8')
const callingFloor = readFileSync('src/components/prospecting/prospecting-calling-floor.tsx', 'utf8')
const sessionControl = readFileSync('src/components/prospecting/use-prospecting-session-control.ts', 'utf8')
const sessionCommand = readFileSync('src/components/dialer/dialer-session-command.tsx', 'utf8')
const contextRail = readFileSync('src/components/prospecting/prospecting-calling-context-rail.tsx', 'utf8')
const appShell = readFileSync('src/components/layout/app-shell.tsx', 'utf8')
const dialerEntry = readFileSync('src/components/telephony/dialer-entry.tsx', 'utf8')
const crmDialer = readFileSync('src/components/telephony/crm-dialer-modal.tsx', 'utf8')
const prospectingDialer = readFileSync('src/components/prospecting/prospecting-dialer-rail.tsx', 'utf8')
const clientPreflight = readFileSync('src/lib/telephony/dialer-client-preflight.ts', 'utf8')
const legacyCallIntentRoute = readFileSync('src/app/api/dialer/call-intents/route.ts', 'utf8')

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
    expect(sessionControl).toContain('loadDurableDialerSession')
    expect(sessionControl).toContain('transitionDurableDialerSession')
    expect(callingFloor).toContain('durableSession?.callerId || campaignPreview.callerId || requestedCallerId')
    expect(callingFloor).toContain('<DialerSessionCommand')
    expect(callingFloor).toContain('<HeirsSection')
    expect(callingFloor).not.toContain('Reach the right person')
    expect(callingFloor).not.toContain('Safety checked before every dial')
    expect(callingFloor).toContain('session.queueItems')
    expect(callingFloor).toContain('prospect_ids')
    expect(callingFloor).toContain('prospectId={currentProspectId}')
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

  it('keeps CRM and Prospecting controllers explicit over the shared phone core', () => {
    expect(appShell).toContain("surface={isProspectingCallingFloor ? 'prospecting' : 'crm'}")
    expect(dialerEntry).toContain('<CrmDialerModal')
    expect(dialerEntry).toContain('<ProspectingDialerRail')
    expect(crmDialer).toContain('surface="crm" presentation="modal" pendingSessionId={null}')
    expect(prospectingDialer).toContain('surface="prospecting" presentation="workspace"')
    expect(clientPreflight).toContain('dialerCallIntentEndpoint(input.surface)')
    expect(legacyCallIntentRoute).toContain('status: 410')
    expect(legacyCallIntentRoute).toContain("reasonSource: 'legacy_endpoint'")
    expect(legacyCallIntentRoute).not.toContain('handleWebDialerCallIntent')
  })

  it('keeps session controls explicit and the seller history bounded', () => {
    expect(sessionCommand).toContain('End session')
    expect(sessionCommand).toContain('Pause session')
    expect(sessionCommand).toContain('Back to campaigns')
    expect(sessionCommand).toContain('Hang up')
    expect(sessionCommand).toContain('Stop this session?')
    expect(sessionCommand).toContain('bg-[var(--ck-surface)]')
    expect(sessionCommand).not.toContain('bg-[#101827]')
    expect(contextRail).toContain('max-h-[360px]')
    expect(contextRail).toContain('overflow-y-auto')
    expect(contextRail).toContain('Open full conversation')
    expect(contextRail).not.toContain('Recent Calls')
    expect(callingFloor).not.toContain('/api/call-log?limit=50')
  })
})
