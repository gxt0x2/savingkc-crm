/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceFrame } from '@/components/conversations/workspace-frame'
import { ProspectingCallingContextRail } from '@/components/prospecting/prospecting-calling-context-rail'
import { SoftphoneCore } from '@/components/telephony/telephony-bar'

const twilio = vi.hoisted(() => {
  class MockDevice {
    static instances: MockDevice[] = []
    handlers = new Map<string, (...args: unknown[]) => void>()
    register = vi.fn(async () => {
      this.handlers.get('registered')?.()
    })
    destroy = vi.fn()
    updateToken = vi.fn()
    constructor() {
      MockDevice.instances.push(this)
    }
    on(name: string, handler: (...args: unknown[]) => void) {
      this.handlers.set(name, handler)
    }
  }
  return { MockDevice }
})

vi.mock('@twilio/voice-sdk', () => ({ Device: twilio.MockDevice }))
vi.mock('@/lib/telephony/microphone-preflight', () => ({
  verifyMicrophoneInput: vi.fn(async () => undefined),
  microphoneFailureMessage: (error: unknown) => (error instanceof Error ? error.message : 'Microphone unavailable'),
  MICROPHONE_SILENCE_MESSAGE: 'Your microphone is not sending audio.',
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/prospecting',
  useSearchParams: () => new URLSearchParams('session_id=session-1'),
}))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, isPending: false }),
}))
vi.mock('@/hooks/use-theme-preference', () => ({
  useThemePreference: () => ({ theme: 'light' as const, toggle: vi.fn() }),
}))
vi.mock('@/components/telephony/global-dialer-button', () => ({
  GlobalDialerButton: () => <button type="button">Open phone</button>,
}))
vi.mock('@/components/conversations/workspace-nav', () => ({
  WorkspaceNav: () => <nav>Workspace</nav>,
  WorkspaceMobileNav: () => <nav>Mobile</nav>,
  workspaceLabelForPath: () => 'Prospecting',
}))
vi.mock('@/components/conversations/workspace-context-nav', () => ({
  WorkspaceContextNav: () => <nav>Context</nav>,
}))
vi.mock('@/components/leads/google-map-panel', () => ({
  StreetViewPanel: ({ address }: { address: string }) => <div>Street View for {address}</div>,
}))
vi.mock('@/components/ai/giraffe-assistant-launcher', () => ({
  GiraffeAssistantLauncher: () => null,
}))

const prospect = {
  id: 'prospect-1',
  owner_1: 'Mary Seller',
  situs_street: '123 Main Street',
  situs_city: 'Kansas City',
  situs_state: 'MO',
  situs_zip: '64108',
  county: 'Jackson',
  is_deceased: true,
  occupancy_status: 'absentee',
  delinquent_years_category: '2-year',
  mailing_street: 'PO Box 55',
  mailing_city: 'Liberty',
  mailing_state: 'MO',
  mailing_zip: '64068',
  cumulative_due: 6_000,
  zestimate: 198_000,
  total_market_value: 144_000,
  earliest_delinquent_year: 2024,
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body }
}

function livePhone() {
  return (
    <SoftphoneCore
      surface="prospecting"
      presentation="workspace"
      open
      onClose={() => undefined}
      pendingSessionId="session-1"
      signedInEmail="ernest@savingkc.com"
    />
  )
}

function CallingSession({ prospectId, ownerName }: { prospectId: string; ownerName: string }) {
  return (
    <WorkspaceFrame focusedCalling rightRail={livePhone()}>
      <ProspectingCallingContextRail
        campaignId="campaign-1"
        leadId={null}
        lead={null}
        prospect={{ ...prospect, id: prospectId, owner_1: ownerName }}
        ownerName={ownerName}
        situsAddress="123 Main Street Kansas City, MO 64108"
        coOwners={[]}
        occupancy={null}
        delinquentYears="2 yr"
        durableSessionId="session-1"
        campaignMemberId="member-1"
        presentedPhone="+18165550123"
        activities={[]}
        onRefreshActivities={vi.fn()}
      />
    </WorkspaceFrame>
  )
}

async function expectReadyPhone() {
  await waitFor(() => expect(screen.getByTitle('Reconnect the phone')).toHaveTextContent('Ready'))
  expect(screen.queryByRole('button', { name: 'Connect Twilio' })).not.toBeInTheDocument()
}

describe('prospecting call controls persistence', () => {
  beforeEach(() => {
    twilio.MockDevice.instances.splice(0)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/api/twilio-token')) return jsonResponse({ token: 'voice-token', callerId: '+18165550100', identity: 'ernest' })
      if (url.includes('/api/call-log')) return jsonResponse({ calls: [] })
      if (url.includes('/api/dialer/sessions/')) {
        return jsonResponse({
          session: {
            id: 'session-1',
            status: 'active',
            stopRequestedAt: null,
            currentSubjectKind: 'prospect',
            currentSubjectId: 'prospect-1',
            currentCampaignMemberId: 'member-1',
          },
          attempts: { items: [] },
        })
      }
      return jsonResponse({})
    }))
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => []),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      },
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the same Ready Twilio device when the next prospect replaces the seller workspace', async () => {
    const view = render(<CallingSession prospectId="prospect-1" ownerName="Mary Seller" />)
    await expectReadyPhone()
    expect(twilio.MockDevice.instances).toHaveLength(1)
    expect(twilio.MockDevice.instances[0]?.destroy).not.toHaveBeenCalled()

    view.rerender(<CallingSession prospectId="prospect-2" ownerName="Nora Seller" />)

    expect(screen.getByRole('heading', { name: 'Nora Seller' })).toBeVisible()
    await expectReadyPhone()
    expect(twilio.MockDevice.instances).toHaveLength(1)
    expect(twilio.MockDevice.instances[0]?.destroy).not.toHaveBeenCalled()
    expect(screen.getByRole('complementary', { name: 'Persistent live dialer controls' })).toContainElement(screen.getByTitle('Reconnect the phone'))
  })

  it('reconnects when the Twilio device actually drops', async () => {
    render(<CallingSession prospectId="prospect-1" ownerName="Mary Seller" />)
    await expectReadyPhone()
    const device = twilio.MockDevice.instances[0]
    expect(device).toBeDefined()

    act(() => {
      device?.handlers.get('unregistered')?.()
    })

    expect(screen.getByTitle('Reconnect the phone')).toHaveTextContent('Offline')
    expect(screen.getByRole('button', { name: 'Connect Twilio' })).toBeVisible()
    expect(device?.destroy).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Connect Twilio' }))

    await expectReadyPhone()
    expect(device?.destroy).toHaveBeenCalledOnce()
    expect(twilio.MockDevice.instances).toHaveLength(2)
  })

  it('releases the device when the dial session ends and connects a new one on the next session', async () => {
    const view = render(<CallingSession prospectId="prospect-1" ownerName="Mary Seller" />)
    await expectReadyPhone()
    const first = twilio.MockDevice.instances[0]

    view.rerender(
      <WorkspaceFrame>
        <main>Campaign list</main>
      </WorkspaceFrame>,
    )

    expect(screen.queryByTitle('Reconnect the phone')).not.toBeInTheDocument()
    expect(screen.getByText('Campaign list')).toBeVisible()
    expect(first?.destroy).toHaveBeenCalledOnce()

    view.rerender(<CallingSession prospectId="prospect-9" ownerName="Helen Seller" />)

    await expectReadyPhone()
    expect(twilio.MockDevice.instances).toHaveLength(2)
    expect(twilio.MockDevice.instances[1]).not.toBe(first)
    expect(twilio.MockDevice.instances[1]?.destroy).not.toHaveBeenCalled()
  })
})
