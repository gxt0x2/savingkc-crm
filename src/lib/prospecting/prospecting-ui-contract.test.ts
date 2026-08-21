import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspace = readFileSync(join(process.cwd(), 'src/components/prospecting/prospecting-workspace.tsx'), 'utf8')
const contacts = readFileSync(join(process.cwd(), 'src/app/(app)/contacts/page.tsx'), 'utf8')
const navigation = readFileSync(join(process.cwd(), 'src/components/layout/nav-tab.tsx'), 'utf8')
const appShell = readFileSync(join(process.cwd(), 'src/components/layout/app-shell.tsx'), 'utf8')

describe('prospecting workspace UI contract', () => {
  it('hands selected contacts to a first-class campaign builder', () => {
    expect(contacts).toContain("sessionStorage.setItem('savingkc-prospecting-audience-v1'")
    expect(contacts).toContain('Start campaign')
    expect(workspace).toContain("'/api/prospecting/campaigns'")
    expect(workspace).toContain("/members`")
  })

  it('presents the internal Mojo and Launch Control workflows without fake predictive claims', () => {
    expect(workspace).toContain('Single-line dialer')
    expect(workspace).toContain('SMS sequence')
    expect(workspace).toContain('Stops automatically when the contact replies or opts out.')
    expect(workspace.toLowerCase()).not.toContain('predictive')
  })

  it('consolidates Dialer and Conversations under Prospecting navigation', () => {
    expect(navigation).toContain("{ label: 'Prospecting', href: '/prospecting'")
    expect(navigation).not.toContain("{ label: 'Dialer', href: '/dialer', icon: 'phone_in_talk' },\n  { label: 'Ads'")
    expect(appShell).toContain("pathname?.startsWith('/prospecting')")
  })
})
