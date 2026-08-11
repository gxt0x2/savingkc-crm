/** @vitest-environment jsdom */

import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from './app-shell'

const navigation = vi.hoisted(() => ({ pathname: '/dashboard' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

vi.mock('next/dynamic', () => ({
  default: () => function DynamicComponent(props: { open?: boolean; onClose?: () => void }) {
    if (typeof props.open !== 'boolean') return null
    return <div data-testid="lazy-dialer" data-open={String(props.open)}><button type="button" onClick={props.onClose}>Close phone</button></div>
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
  WorkspaceFrame: ({ children }: { children: React.ReactNode }) => <div data-testid="workspace-frame">{children}</div>,
}))

describe('AppShell first-load work', () => {
  beforeEach(() => {
    navigation.pathname = '/dashboard'
    vi.stubGlobal('fetch', vi.fn())
  })

  it('does not mount the softphone or request a legacy profile on a modern route', () => {
    render(<AppShell><main>Dashboard content</main></AppShell>)

    expect(screen.getByText('Dashboard content')).toBeInTheDocument()
    expect(screen.queryByTestId('lazy-dialer')).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('loads the softphone only after the global phone control is used', () => {
    render(<AppShell><main>Dashboard content</main></AppShell>)

    act(() => window.dispatchEvent(new Event('open-global-dialer')))

    expect(screen.getByTestId('lazy-dialer')).toHaveAttribute('data-open', 'true')
  })
})
