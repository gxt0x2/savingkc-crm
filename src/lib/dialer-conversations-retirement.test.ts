import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const dialerPage = readFileSync('src/app/(app)/dialer/page.tsx', 'utf8')
const redirects = readFileSync('next.config.ts', 'utf8')
const operatingReports = readFileSync('src/components/reports/operating-reports-workspace.tsx', 'utf8')
const acquisitionsReports = readFileSync('src/app/(app)/dashboard/components/AcquisitionsReportsWorkspace.tsx', 'utf8')

describe('Dialer Conversations retirement', () => {
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
})
