import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dialerPage = readFileSync('src/app/(app)/dialer/page.tsx', 'utf8')
const dialerSessionHistory = readFileSync('src/components/dialer/dialer-session-history.tsx', 'utf8')
const redirects = readFileSync('next.config.ts', 'utf8')
const operatingReports = readFileSync('src/components/reports/operating-reports-workspace.tsx', 'utf8')
const acquisitionsReports = readFileSync('src/app/(app)/dashboard/components/AcquisitionsReportsWorkspace.tsx', 'utf8')

describe('Dialer workspace consolidation', () => {
  it('removes the duplicate client-scanning inbox from the Dialer bundle', () => {
    expect(existsSync('src/components/dialer/dialer-conversation-hub.tsx')).toBe(false)
    expect(dialerPage).not.toContain('DialerConversationHub')
    expect(dialerPage).not.toContain("'conversations'")
  })

  it('keeps old bookmarks on the canonical Conversations workspace', () => {
    expect(redirects).toContain("key: 'section', value: 'conversations'")
    expect(redirects).toContain("destination: '/conversations'")
  })

  it('routes reporting drill-downs to the authoritative inbox', () => {
    expect(operatingReports).toContain('href="/conversations?channel=call"')
    expect(acquisitionsReports).toContain('href="/conversations"')
    expect(`${operatingReports}\n${acquisitionsReports}`).not.toContain('/dialer?section=conversations')
  })

  it('removes duplicate analytics and settings while preserving legacy bookmarks', () => {
    expect(dialerPage).not.toContain('DialerAnalyticsView')
    expect(dialerPage).not.toContain('DialerSettingsView')
    expect(dialerPage).not.toContain("homeSection === 'analytics'")
    expect(dialerPage).not.toContain("homeSection === 'settings'")
    expect(redirects).toContain("key: 'section', value: 'analytics'")
    expect(redirects).toContain("destination: '/reports/call-sms'")
    expect(redirects).toContain("key: 'section', value: 'settings'")
    expect(redirects).toContain("destination: '/dialer?section=queue'")
  })

  it('routes call reporting directly to the canonical report', () => {
    expect(acquisitionsReports).toContain('href="/reports/call-sms"')
    expect(dialerSessionHistory).toContain('href="/reports/call-sms"')
    expect(`${dialerPage}\n${dialerSessionHistory}\n${operatingReports}\n${acquisitionsReports}`).not.toContain('/dialer?section=analytics')
  })
})
