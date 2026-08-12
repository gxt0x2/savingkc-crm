import { describe, expect, it, vi } from 'vitest'

import Home from './page'

const redirect = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ redirect }))

describe('CRM entry route', () => {
  it('opens the operating dashboard instead of the multi-request ARI workspace', () => {
    Home()

    expect(redirect).toHaveBeenCalledWith('/dashboard')
  })
})
