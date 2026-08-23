import { beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'

import AriPage from '@/app/(app)/ari/page'
import InClosingPage from '@/app/(app)/in-closing/page'
import LeadsPage from '@/app/(app)/leads/page'
import OpportunitiesPage from '@/app/(app)/opportunities/page'

const navigation = vi.hoisted(() => ({ redirect: vi.fn() }))

vi.mock('next/navigation', () => ({ redirect: navigation.redirect }))

describe('legacy CRM surface retirement', () => {
  beforeEach(() => navigation.redirect.mockReset())

  it.each([
    ['Leads', LeadsPage, '/contacts'],
    ['In Closing', InClosingPage, '/contacts?list=in_closing'],
    ['Hot Opportunities', OpportunitiesPage, '/contacts?list=qualified'],
    ['ARI dashboard', AriPage, '/ai'],
  ])('redirects %s to its canonical workspace', (_label, Page, destination) => {
    Page()

    expect(navigation.redirect).toHaveBeenCalledOnce()
    expect(navigation.redirect).toHaveBeenCalledWith(destination)
  })

  it('removes the dead client-aggregated acquisitions dashboard', () => {
    expect(existsSync('src/app/(app)/dashboard/components/AcquisitionsReportsWorkspace.tsx')).toBe(false)
    expect(existsSync('src/app/(app)/dashboard/components/BottleneckCalculator.tsx')).toBe(false)

    const dashboard = readFileSync('src/app/(app)/dashboard/page.tsx', 'utf8')
    const acquisitions = readFileSync('src/app/(app)/reports/acquisitions/page.tsx', 'utf8')
    expect(dashboard).toContain('OperatingReportsWorkspace')
    expect(acquisitions).toContain('OperatingReportsWorkspace')
    expect(`${dashboard}\n${acquisitions}`).not.toContain('AcquisitionsReportsWorkspace')
  })

  it('keeps deceased-owner selection inside the canonical dialer queue', () => {
    expect(existsSync('src/app/api/dialer/deceased-queue/route.ts')).toBe(false)

    const queueRoute = readFileSync('src/app/api/dialer/queue/route.ts', 'utf8')
    expect(queueRoute).toContain(".eq('is_deceased', true)")
    expect(queueRoute).toContain(".in('delinquent_years_category', ['2yr', '3yr_plus'])")
  })

  it('routes every visible ARI entry point to the single persistent assistant', () => {
    const navigation = readFileSync('src/components/layout/nav-tab.tsx', 'utf8')
    const reports = readFileSync('src/components/reports/operating-reports-workspace.tsx', 'utf8')
    const assistant = readFileSync('src/app/(app)/ai/page.tsx', 'utf8')
    const launcher = readFileSync('src/components/ai/giraffe-assistant.tsx', 'utf8')
    const assistantThread = readFileSync('src/hooks/use-assistant-thread.ts', 'utf8')

    expect(navigation).toContain("{ label: 'ARI', href: '/ai', icon: 'assistant' }")
    expect(reports).not.toContain('actionHref="/ari"')
    expect(assistant).toContain("useAssistantThread('ai_page')")
    expect(launcher).toContain("useAssistantThread('giraffe')")
    expect(assistantThread).toContain('loadLatestAssistantThread()')
  })
})
