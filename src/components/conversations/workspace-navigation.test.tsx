/** @vitest-environment jsdom */

import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspaceContextNav } from './workspace-context-nav'
import { WorkspaceNav } from './workspace-nav'

const navigation = vi.hoisted(() => ({ pathname: '/dashboard', search: '' }))

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useSearchParams: () => new URLSearchParams(navigation.search),
}))

vi.mock('next/link', () => ({
  default: ({ href, children, prefetch, ...props }: { href: string; children: React.ReactNode; prefetch?: boolean }) => {
    void prefetch
    return <a href={href} {...props}>{children}</a>
  },
}))

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span aria-label={alt || undefined} role={alt ? 'img' : undefined} />,
}))

describe('workspace navigation', () => {
  beforeEach(() => {
    navigation.pathname = '/dashboard'
    navigation.search = ''
  })

  it('uses the approved compact nine-item order and hides retired menu labels', () => {
    render(<WorkspaceNav needsReply={3} />)

    const navigationRegion = screen.getByRole('navigation', { name: 'CRM navigation' })
    const labels = within(navigationRegion).getAllByRole('link').map((link) => link.getAttribute('aria-label'))
    expect(labels).toEqual(['Dashboard', 'Issue Log', 'Pipeline', 'Conversations', 'Calendar', 'Dialer', 'Task', 'Reports', 'Settings'])
    expect(within(navigationRegion).getByRole('link', { name: 'Pipeline' })).toHaveAttribute('href', '/contacts?list=new')
    expect(within(navigationRegion).getByRole('link', { name: 'Issue Log' })).toHaveAttribute('href', '/reports/andon')
    expect(within(navigationRegion).queryByRole('link', { name: 'Bottlenecks' })).not.toBeInTheDocument()
    expect(within(navigationRegion).queryByRole('link', { name: 'Bingo Board' })).not.toBeInTheDocument()
    expect(within(navigationRegion).queryByRole('link', { name: 'AI Assistant' })).not.toBeInTheDocument()
    expect(within(navigationRegion).queryByRole('link', { name: 'ARI Insights' })).not.toBeInTheDocument()
  })

  it('keeps the system Andon available from the shared CRM navigation', () => {
    render(<WorkspaceNav needsReply={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raise an Andon and report an issue' }))
    expect(screen.getByRole('dialog', { name: 'Report an issue' })).toBeVisible()
    expect(screen.getByRole('button', { name: /Process issue/ })).toBeVisible()
    expect(screen.getByRole('button', { name: /AI Glitch/ })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'What happened' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Why 5' })).toBeVisible()
  })

  it('shows Marketing in the dashboard context bar instead of the retired Bottlenecks board', () => {
    navigation.pathname = '/reports/acquisitions'
    render(<WorkspaceContextNav />)

    const switcher = screen.getByRole('navigation', { name: 'Dashboards sections' })
    expect(within(switcher).getByRole('link', { name: /Company overview/ })).toHaveAttribute('href', '/dashboard')
    expect(within(switcher).getByRole('link', { name: /Acquisitions/ })).toHaveAttribute('aria-current', 'page')
    expect(within(switcher).getByRole('link', { name: /Dispositions/ })).toHaveAttribute('href', '/reports/dispositions')
    expect(within(switcher).getByRole('link', { name: /Marketing/ })).toHaveAttribute('href', '/reports/marketing')
    expect(within(switcher).queryByRole('link', { name: /Bottlenecks/ })).not.toBeInTheDocument()
    expect(within(switcher).queryByRole('link', { name: /Bingo Board/ })).not.toBeInTheDocument()
  })
})
