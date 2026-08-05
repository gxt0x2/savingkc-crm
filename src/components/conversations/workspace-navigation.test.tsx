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
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

vi.mock('next/image', () => ({
  default: ({ alt }: { alt: string }) => <span aria-label={alt || undefined} role={alt ? 'img' : undefined} />,
}))

describe('workspace dashboard navigation', () => {
  beforeEach(() => {
    navigation.pathname = '/dashboard'
    navigation.search = ''
  })

  it('exposes company, acquisitions, and dispositions as dashboards', () => {
    render(<WorkspaceNav needsReply={0} />)

    const navigationRegion = screen.getByRole('navigation', { name: 'CRM navigation' })
    expect(within(navigationRegion).getByRole('button', { name: /Dashboard/ })).toHaveAttribute('aria-expanded', 'true')
    expect(within(navigationRegion).getByRole('link', { name: /Company overview/ })).toHaveAttribute('href', '/dashboard')
    expect(within(navigationRegion).getByRole('link', { name: /Acquisitions/ })).toHaveAttribute('href', '/reports/acquisitions')
    expect(within(navigationRegion).getByRole('link', { name: /Dispositions/ })).toHaveAttribute('href', '/reports/dispositions')
  })

  it('keeps team dashboards out of the generic reports section', () => {
    navigation.pathname = '/contacts'
    render(<WorkspaceNav needsReply={0} />)

    const navigationRegion = screen.getByRole('navigation', { name: 'CRM navigation' })
    fireEvent.click(within(navigationRegion).getByRole('button', { name: /Reports/ }))

    const reportsButton = within(navigationRegion).getByRole('button', { name: /Reports/ })
    expect(reportsButton).toHaveAttribute('aria-expanded', 'true')
    expect(within(navigationRegion).getByRole('link', { name: /Marketing/ })).toBeInTheDocument()
    expect(within(navigationRegion).getByRole('link', { name: /Finance/ })).toBeInTheDocument()
    expect(within(navigationRegion).queryByRole('link', { name: /^Acquisitions$/ })).not.toBeInTheDocument()
    expect(within(navigationRegion).queryByRole('link', { name: /^Dispositions$/ })).not.toBeInTheDocument()
  })

  it('shows the dashboard switcher on each team dashboard', () => {
    navigation.pathname = '/reports/acquisitions'
    render(<WorkspaceContextNav />)

    const switcher = screen.getByRole('navigation', { name: 'Dashboards sections' })
    expect(within(switcher).getByRole('link', { name: /Company overview/ })).toHaveAttribute('href', '/dashboard')
    expect(within(switcher).getByRole('link', { name: /Acquisitions/ })).toHaveAttribute('aria-current', 'page')
    expect(within(switcher).getByRole('link', { name: /Dispositions/ })).toHaveAttribute('href', '/reports/dispositions')
  })
})
