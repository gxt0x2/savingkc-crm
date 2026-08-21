import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspace = readFileSync(join(process.cwd(), 'src/components/prospecting/prospecting-workspace.tsx'), 'utf8')
const studio = readFileSync(join(process.cwd(), 'src/components/prospecting/campaign-studio.tsx'), 'utf8')
const dashboard = readFileSync(join(process.cwd(), 'src/components/prospecting/campaign-dashboard.tsx'), 'utf8')
const contacts = readFileSync(join(process.cwd(), 'src/app/(app)/contacts/page.tsx'), 'utf8')
const navigation = readFileSync(join(process.cwd(), 'src/components/layout/nav-tab.tsx'), 'utf8')
const appShell = readFileSync(join(process.cwd(), 'src/components/layout/app-shell.tsx'), 'utf8')
const workspaceNavigation = readFileSync(join(process.cwd(), 'src/components/conversations/workspace-nav.tsx'), 'utf8')

describe('prospecting workspace UI contract', () => {
  it('hands selected contacts to a first-class campaign builder', () => {
    expect(contacts).toContain("sessionStorage.setItem('savingkc-prospecting-audience-v1'")
    expect(contacts).toContain('Start campaign')
    expect(workspace).toContain("'/api/prospecting/campaigns'")
    expect(workspace).toContain("/members`")
  })

  it('presents the internal Mojo and Launch Control workflows without fake predictive claims', () => {
    expect(studio).toContain('Power dialer')
    expect(studio).toContain('SMS cadence')
    expect(studio).toContain('Replies stop automation')
    expect(dashboard).toContain('Stops immediately when a seller replies or opts out.')
    expect(`${workspace}\n${studio}\n${dashboard}`).not.toContain("mode='predictive'")
    expect(`${workspace}\n${studio}\n${dashboard}`).not.toContain('3 lines')
  })

  it('consolidates Dialer and Conversations under Prospecting navigation', () => {
    expect(navigation).toContain("{ label: 'Prospecting', href: '/prospecting'")
    expect(navigation).not.toContain("{ label: 'Dialer', href: '/dialer', icon: 'phone_in_talk' },\n  { label: 'Ads'")
    expect(appShell).toContain("pathname?.startsWith('/prospecting')")
    expect(workspaceNavigation).toContain("{ label: 'Prospecting', icon: 'campaign', href: '/prospecting', activeOn: ['/prospecting', '/dialer', '/conversations'] }")
    expect(workspaceNavigation).not.toContain("{ label: 'Conversations', icon: 'forum'")
    expect(workspaceNavigation).not.toContain("{ label: 'Dialer', icon: 'dialpad'")
  })
})
