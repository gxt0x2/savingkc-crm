import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workspace = readFileSync(join(process.cwd(), 'src/components/prospecting/prospecting-workspace.tsx'), 'utf8')
const studio = readFileSync(join(process.cwd(), 'src/components/prospecting/campaign-studio.tsx'), 'utf8')
const dashboard = readFileSync(join(process.cwd(), 'src/components/prospecting/campaign-dashboard.tsx'), 'utf8')
const audienceWorkbench = readFileSync(join(process.cwd(), 'src/components/prospecting/campaign-audience-workbench.tsx'), 'utf8')
const contacts = readFileSync(join(process.cwd(), 'src/app/(app)/contacts/page.tsx'), 'utf8')
const navigation = readFileSync(join(process.cwd(), 'src/components/layout/nav-tab.tsx'), 'utf8')
const appShell = readFileSync(join(process.cwd(), 'src/components/layout/app-shell.tsx'), 'utf8')
const workspaceNavigation = readFileSync(join(process.cwd(), 'src/components/conversations/workspace-nav.tsx'), 'utf8')
const contextNavigation = readFileSync(join(process.cwd(), 'src/components/conversations/workspace-context-nav.tsx'), 'utf8')
const dialerPage = readFileSync(join(process.cwd(), 'src/app/(app)/dialer/page.tsx'), 'utf8')
const prospectingPage = readFileSync(join(process.cwd(), 'src/app/(app)/prospecting/page.tsx'), 'utf8')
const callingFloor = readFileSync(join(process.cwd(), 'src/components/prospecting/prospecting-calling-floor.tsx'), 'utf8')

describe('prospecting workspace UI contract', () => {
  it('hands selected contacts to a first-class campaign builder', () => {
    expect(contacts).toContain('sessionStorage.setItem(PROSPECTING_AUDIENCE_STORAGE_KEY')
    expect(contacts).toContain('campaignAudienceReturnHref(requestedCampaignId)')
    expect(contacts).toContain("'Start campaign'")
    expect(workspace).toContain("'/api/prospecting/campaigns'")
    expect(workspace).toContain("/members`")
    expect(dashboard).toContain('<CampaignAudienceWorkbench')
    expect(audienceWorkbench).toContain('campaignAudienceContactsHref(campaignId, campaignName)')
    expect(contacts).toContain('matching contacts</button>')
    expect(workspace).toContain('parseStoredProspectingAudienceSelection')
    expect(workspace).toMatch(/function closeBuilder\(\)[\s\S]*pendingAudience[\s\S]*sessionStorage\.removeItem\(PROSPECTING_AUDIENCE_STORAGE_KEY\)[\s\S]*setPendingAudience\(null\)/)
  })

  it('presents the internal Mojo and Launch Control workflows without fake predictive claims', () => {
    expect(studio).toContain('Power dialer')
    expect(studio).toContain('SMS cadence')
    expect(studio).toContain('Replies stop automation')
    expect(dashboard).toContain('Stops immediately when a seller replies or opts out.')
    expect(`${workspace}\n${studio}\n${dashboard}`).not.toContain("mode='predictive'")
    expect(`${workspace}\n${studio}\n${dashboard}`).not.toContain('3 lines')
  })

  it('keeps the active campaign pulse current only while the operator can see it', () => {
    expect(workspace).toContain('CAMPAIGN_LIVE_REFRESH_MS = 15000')
    expect(workspace).toContain("document.visibilityState !== 'visible'")
    expect(workspace).toContain('loadDetail(selectedId, true)')
    expect(workspace).toContain("document.addEventListener('visibilitychange', refreshOnVisible)")
    expect(workspace).toContain('window.clearInterval(interval)')
    expect(dashboard).toContain('Live · ${timeLabel(lastRefreshedAt)}')
    expect(dashboard).toContain('Updates delayed')
  })

  it('edits a never-run draft without duplicating or activating it', () => {
    expect(dashboard).toContain('Edit setup')
    expect(workspace).toContain('editableProspectingCampaignSetup(campaign)')
    expect(workspace).toContain('JSON.stringify({')
    expect(workspace).toContain('setup: {')
    expect(studio).toContain('Save draft setup')
    expect(studio).toContain('Saving does not activate it')
  })

  it('keeps Prospecting self-contained while Conversations remains a first-class workspace', () => {
    expect(navigation).toContain("{ label: 'Prospecting', href: '/prospecting'")
    expect(navigation).toContain("{ label: 'Conversations', href: '/conversations', icon: 'forum' }")
    expect(navigation).not.toContain("{ label: 'Dialer', href: '/dialer', icon: 'phone_in_talk' },\n  { label: 'Ads'")
    expect(appShell).toContain("pathname?.startsWith('/prospecting')")
    expect(workspaceNavigation).toContain("{ label: 'Prospecting', icon: 'campaign', href: '/prospecting', activeOn: ['/prospecting', '/dialer'] }")
    expect(workspaceNavigation).toContain("{ label: 'Conversations', icon: 'forum', href: '/conversations', activeOn: ['/conversations'] }")
    expect(workspaceNavigation).not.toContain("{ label: 'Dialer', icon: 'dialpad'")
    expect(contextNavigation).not.toContain("pathPrefix: '/prospecting'")
    expect(contextNavigation).not.toContain("pathPrefix: '/dialer'")
    expect(workspace).toContain('router.push(`/prospecting?${query.toString()}`)')
    expect(prospectingPage).toContain('if (executionKey) return <ProspectingCallingFloor')
    expect(dialerPage).toContain("redirect(query ? `/prospecting?${query}` : '/prospecting')")
    expect(callingFloor).toContain('export function ProspectingCallingFloor()')
    expect(callingFloor).not.toContain('function DialerHome')
  })

  it('keeps the calling floor on relational facts instead of Manifest compatibility data', () => {
    expect(callingFloor).toContain('currentProspect?.occupancy_status')
    expect(callingFloor).toContain('payload.coOwners')
    expect(callingFloor).not.toContain('loadDialerLeadContext')
    expect(callingFloor).not.toContain('currentManifest')
  })
})
