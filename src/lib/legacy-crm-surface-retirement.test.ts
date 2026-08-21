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
    ['Hot Opportunities', OpportunitiesPage, '/contacts?list=hot'],
    ['ARI dashboard', AriPage, '/dashboard'],
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
})
