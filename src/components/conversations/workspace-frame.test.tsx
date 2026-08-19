/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useWorkspaceUserEmail, WorkspaceChrome, WorkspaceFrame } from './workspace-frame'

const useQueryMock = vi.hoisted(() => vi.fn(() => ({ data: undefined, isPending: false })))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/dashboard',
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: useQueryMock,
}))

vi.mock('@/hooks/use-theme-preference', () => ({
  useThemePreference: () => ({ theme: 'light', toggle: vi.fn() }),
}))

vi.mock('@/components/telephony/global-dialer-button', () => ({
  GlobalDialerButton: () => <button type="button">Open phone</button>,
}))

vi.mock('./workspace-nav', () => ({
  WorkspaceNav: ({ needsReply }: { needsReply: number | null }) => <nav data-testid="workspace-nav">{needsReply ?? 'unavailable'}</nav>,
  WorkspaceMobileNav: ({ needsReply }: { needsReply: number | null }) => <nav data-testid="workspace-mobile-nav">{needsReply ?? 'unavailable'}</nav>,
  workspaceLabelForPath: () => 'Dashboard',
}))

vi.mock('./workspace-context-nav', () => ({
  WorkspaceContextNav: () => <nav>Context navigation</nav>,
}))

describe('WorkspaceFrame route persistence', () => {
  function ProfileAwareContent() {
    return <p>Active profile: {useWorkspaceUserEmail()}</p>
  }

  it('provides the active viewed profile to profile-aware pages', () => {
    render(
      <WorkspaceFrame userEmail="casey@savingkc.com">
        <ProfileAwareContent />
      </WorkspaceFrame>,
    )

    expect(screen.getByText('Active profile: casey@savingkc.com')).toBeVisible()
  })

  it('lets a route replace the persistent command bar and notification count', () => {
    const { rerender } = render(
      <WorkspaceFrame needsReply={2}>
        <WorkspaceChrome needsReply={7} commandBar={<div>Contacts command bar</div>} />
        <main>Contacts route</main>
      </WorkspaceFrame>,
    )

    expect(screen.getByText('Contacts command bar')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Search contacts, properties, or messages' })).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-nav')).toHaveTextContent('7')
    expect(within(screen.getByRole('button', { name: 'Notifications' })).getByText('7')).toBeInTheDocument()

    rerender(
      <WorkspaceFrame needsReply={2}>
        <main>Dashboard route</main>
      </WorkspaceFrame>,
    )

    expect(screen.getByRole('textbox', { name: 'Search contacts, properties, or messages' })).toBeInTheDocument()
    expect(screen.queryByText('Contacts command bar')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-nav')).toHaveTextContent('2')
  })

  it('keeps the global phone control in the persistent header', () => {
    render(
      <WorkspaceFrame needsReply={0}>
        <main>Dashboard route</main>
      </WorkspaceFrame>,
    )

    expect(screen.getByRole('button', { name: 'Open phone' })).toBeInTheDocument()
  })

  it('does not render a false zero badge while the global conversation count is unknown', () => {
    render(
      <WorkspaceFrame>
        <main>Dashboard route</main>
      </WorkspaceFrame>,
    )

    expect(within(screen.getByRole('button', { name: 'Notifications' })).queryByText('0')).not.toBeInTheDocument()
    expect(screen.getByTestId('workspace-nav')).toHaveTextContent('unavailable')
    expect(screen.getByTestId('workspace-mobile-nav')).toHaveTextContent('unavailable')
    expect(useQueryMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }))

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }))

    expect(useQueryMock).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('shows the viewed agent profile photo in the persistent header', () => {
    render(
      <WorkspaceFrame needsReply={0} userEmail="casey@savingkc.com" profilePhotoUrl="https://example.com/casey.jpg">
        <main>Casey workspace</main>
      </WorkspaceFrame>,
    )

    expect(screen.getByRole('img', { name: 'Casey profile' })).toHaveAttribute('src', 'https://example.com/casey.jpg')
  })

  it('opens the user menu below the persistent header and above page content', () => {
    render(
      <WorkspaceFrame userEmail="casey@savingkc.com">
        <main>Casey workspace</main>
      </WorkspaceFrame>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open user menu' }))

    const menu = screen.getByRole('link', { name: 'Dashboard' }).parentElement
    expect(menu).toHaveClass('top-full', 'z-[70]')
    expect(menu?.closest('header')).toHaveClass('z-[60]', 'overflow-visible')
  })

  it('opens the persistent giraffe assistant from the lower-right launcher', async () => {
    render(
      <WorkspaceFrame needsReply={0}>
        <main>Pipeline route</main>
      </WorkspaceFrame>,
    )

    const launcher = screen.getByRole('button', { name: 'Open AI Assistant' })
    expect(launcher).toHaveAttribute('aria-expanded', 'false')

    fireEvent.click(launcher)

    expect(await screen.findByRole('dialog', { name: 'AI Assistant' })).toBeVisible()
    expect(screen.getByLabelText('Ask the AI Assistant')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Attach evidence' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Start voice dictation' })).toBeInTheDocument()
    expect(screen.getByText(/SavingKC's recorded goals/)).toBeVisible()
    expect(screen.getByRole('button', { name: 'Close AI Assistant' })).toBeVisible()
  })
})
