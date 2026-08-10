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

describe('workspace dashboard navigation', () => {
  beforeEach(() => {
    navigation.pathname = '/dashboard'
    navigation.search = ''
  })

  it('exposes company, acquisitions, and dispositions as dashboards', () => {
    render(<WorkspaceNav needsReply={0} />)

    const navigationRegion = screen.getByRole('navigation', { name: 'CRM navigation' })
    expect(within(navigationRegion).getByRole('link', { name: /Dashboard$/ })).toHaveAttribute('href', '/dashboard')
    expect(within(navigationRegion).getByRole('button', { name: 'Collapse dashboard menu' })).toHaveAttribute('aria-expanded', 'true')
    expect(within(navigationRegion).getByRole('link', { name: /Company overview/ })).toHaveAttribute('href', '/dashboard')
    expect(within(navigationRegion).getByRole('link', { name: /Acquisitions/ })).toHaveAttribute('href', '/reports/acquisitions')
    expect(navigationRegion.querySelector('a[href="/reports/dispositions"]')).toBeInTheDocument()
  })

  it('keeps the system Andon available from the shared CRM navigation', () => {
    render(<WorkspaceNav needsReply={0} />)

    fireEvent.click(screen.getByRole('button', { name: 'Raise an Andon and report an issue' }))

    expect(screen.getByRole('dialog', { name: 'Report an issue' })).toBeVisible()
    expect(screen.getByRole('combobox', { name: 'Area' })).toHaveValue('Dashboard')
    expect(screen.getByRole('textbox', { name: 'What happened' })).toBeVisible()
  })

  it('keeps team dashboards out of the generic reports section', () => {
    navigation.pathname = '/contacts'
    render(<WorkspaceNav needsReply={0} />)

    const navigationRegion = screen.getByRole('navigation', { name: 'CRM navigation' })
    expect(within(navigationRegion).getByRole('link', { name: /Dashboard$/ })).toBeVisible()
    expect(within(navigationRegion).getByRole('button', { name: 'Expand dashboard menu' })).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(within(navigationRegion).getByRole('button', { name: /Reports/ }))

    const reportsButton = within(navigationRegion).getByRole('button', { name: /Reports/ })
    expect(reportsButton).toHaveAttribute('aria-expanded', 'true')
    expect(within(navigationRegion).getByRole('link', { name: /Marketing/ })).toBeInTheDocument()
    expect(within(navigationRegion).getByRole('link', { name: /Finance/ })).toBeInTheDocument()
    expect(navigationRegion.querySelector('a[href="/reports/acquisitions"]')).not.toBeInTheDocument()
    expect(navigationRegion.querySelector('a[href="/reports/dispositions"]')).not.toBeInTheDocument()
  })

  it('keeps one direct dispositions portal entry for the shared operating workspace', () => {
    navigation.pathname = '/contacts'
    render(<WorkspaceNav needsReply={0} />)

    const navigationRegion = screen.getByRole('navigation', { name: 'CRM navigation' })
    expect(within(navigationRegion).getByRole('link', { name: /^Dispositions$/ })).toHaveAttribute('href', '/dispo/pipeline')
    expect(within(navigationRegion).queryByRole('link', { name: /^Transaction coordination$/ })).not.toBeInTheDocument()
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
