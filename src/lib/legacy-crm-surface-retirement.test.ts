import { beforeEach, describe, expect, it, vi } from 'vitest'

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
})
