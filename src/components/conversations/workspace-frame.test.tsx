/** @vitest-environment jsdom */

import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WorkspaceChrome, WorkspaceFrame } from './workspace-frame'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: { items: [] } }),
}))

vi.mock('@/hooks/use-theme-preference', () => ({
  useThemePreference: () => ({ theme: 'light', toggle: vi.fn() }),
}))

vi.mock('@/components/telephony/global-dialer-button', () => ({
  GlobalDialerButton: () => <button type="button">Open phone</button>,
}))

vi.mock('./workspace-nav', () => ({
  WorkspaceNav: ({ needsReply }: { needsReply: number }) => <nav data-testid="workspace-nav">{needsReply}</nav>,
}))

vi.mock('./workspace-context-nav', () => ({
  WorkspaceContextNav: () => <nav>Context navigation</nav>,
}))

describe('WorkspaceFrame route persistence', () => {
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
})
