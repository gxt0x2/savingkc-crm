/** @vitest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from './app-shell'

const navigation = vi.hoisted(() => ({ pathname: '/dashboard', search: '', replace: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn(), replace: navigation.replace }),
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('next/dynamic', () => ({
  default: () => function DynamicComponent(props: { open?: boolean; onClose?: () => void; pendingSessionId?: string | null; presentation?: string }) {
    if (typeof props.open !== 'boolean') return null
    return <div data-testid="lazy-dialer" data-open={String(props.open)} data-presentation={props.presentation} data-session-id={props.pendingSessionId ?? ''}><button type="button" onClick={props.onClose}>Close phone</button></div>
  },
}))

vi.mock('@/hooks/use-auth', () => ({
  useAuth: () => ({ user: { email: 'ernest@savingkc.com' }, signOut: vi.fn() }),
}))

vi.mock('@/hooks/use-app-mode', () => ({
  useAppMode: () => ({ mode: 'acquisitions', setMode: vi.fn() }),
}))

vi.mock('@/hooks/use-theme-preference', () => ({
  useThemePreference: () => ({ theme: 'light', toggle: vi.fn() }),
}))

vi.mock('@/components/conversations/workspace-frame', () => ({
  WorkspaceFrame: ({ children, userEmail, profilePhotoUrl, focusedCalling, rightRail }: { children: React.ReactNode; userEmail?: string | null; profilePhotoUrl?: string | null; focusedCalling?: boolean; rightRail?: React.ReactNode }) => <div data-testid="workspace-frame" data-user-email={userEmail} data-profile-photo={profilePhotoUrl ?? ''} data-focused-calling={String(Boolean(focusedCalling))}>{children}{rightRail}</div>,
}))

describe('AppShell first-load work', () => {
  beforeEach(() => {
    navigation.pathname = '/dashboard'
    navigation.search = ''
    navigation.replace.mockReset()
    window.sessionStorage.clear()
    window.localStorage.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ profile: { profile_photo_url: 'https://example.com/ernest.jpg' } }),
    }))
  })

  it('does not mount the softphone and loads the viewed profile on a modern route', async () => {
    render(<AppShell><main>Dashboard content</main></AppShell>)

    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
    expect(screen.queryByTestId('lazy-dialer')).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/settings?email=ernest%40savingkc.com'))
  })

  it('loads the softphone only after the global phone control is used', () => {
    render(<AppShell><main>Dashboard content</main></AppShell>)

    act(() => window.dispatchEvent(new Event('open-global-dialer')))

    expect(screen.getByTestId('lazy-dialer')).toHaveAttribute('data-open', 'true')
  })

  it('keeps one softphone persistently embedded during a Prospecting session', () => {
    navigation.pathname = '/prospecting'
    navigation.search = 'session_id=session-1'
    render(<AppShell><main>Calling floor</main></AppShell>)

    expect(screen.getByTestId('workspace-frame')).toHaveAttribute('data-focused-calling', 'true')
    expect(screen.getByTestId('lazy-dialer')).toHaveAttribute('data-presentation', 'workspace')
    expect(screen.getByTestId('lazy-dialer')).toHaveAttribute('data-open', 'true')
    expect(screen.getByTestId('lazy-dialer')).toHaveAttribute('data-session-id', 'session-1')

    act(() => window.dispatchEvent(new CustomEvent('open-dialer-queue', { detail: {
      queue: [{ phone: '+18165550100', heirName: 'Helen Seller' }],
      sessionId: 'session-1',
    } })))

    fireEvent.click(screen.getByRole('button', { name: 'Close phone' }))
    expect(screen.getByTestId('lazy-dialer')).toHaveAttribute('data-open', 'true')

    act(() => window.dispatchEvent(new Event('show-dialer-controls')))
    expect(screen.getByTestId('lazy-dialer')).toHaveAttribute('data-presentation', 'workspace')
    expect(screen.getByTestId('lazy-dialer')).toHaveAttribute('data-open', 'true')
  })

  it('does not reopen the session dialer after returning to the campaign screen', () => {
    navigation.pathname = '/prospecting'
    navigation.search = 'session_id=session-1&campaign=campaign-1'
    const { rerender } = render(<AppShell><main>Calling floor</main></AppShell>)

    act(() => window.dispatchEvent(new CustomEvent('open-dialer-queue', { detail: {
      queue: [{ phone: '+18165550100', heirName: 'Helen Seller' }],
      sessionId: 'session-1',
    } })))
    expect(screen.getByTestId('lazy-dialer')).toBeInTheDocument()

    navigation.search = 'campaign=campaign-1'
    rerender(<AppShell><main>Campaign screen</main></AppShell>)

    expect(screen.queryByTestId('lazy-dialer')).not.toBeInTheDocument()
    expect(screen.getByText('Campaign screen')).toBeVisible()
  })

  it('removes a cached profile photo after the server confirms it was deleted', async () => {
    window.localStorage.setItem('savingkc:profile-photo:ernest@savingkc.com', 'https://example.com/stale.jpg')
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ profile: { profile_photo_url: null } }),
    } as unknown as Response)

    render(<AppShell><main>Dashboard content</main></AppShell>)

    await waitFor(() => {
      expect(window.localStorage.getItem('savingkc:profile-photo:ernest@savingkc.com')).toBeNull()
    }, { timeout: 2_500 })
    expect(screen.getByTestId('workspace-frame')).toHaveAttribute('data-profile-photo', '')
  })

  it('redirects an owner-selected Casey workspace to My Day without painting the company dashboard', () => {
    window.sessionStorage.setItem('savingkc:viewed-agent-email', 'casey@savingkc.com')

    render(<AppShell><main>Dashboard content</main></AppShell>)

    expect(screen.getByTestId('workspace-frame')).toHaveAttribute('data-user-email', 'casey@savingkc.com')
    expect(navigation.replace).toHaveBeenCalledWith('/my-day')
    expect(screen.queryByText('Dashboard content')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Opening Casey’s My Day…')
  })
})
