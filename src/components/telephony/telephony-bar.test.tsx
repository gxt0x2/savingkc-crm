import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { DialerPanel } from './telephony-bar'

vi.mock('next/navigation', () => ({
  usePathname: () => '/leads/24a1fd7f-a31d-41ea-aae0-7948516dd37c/c',
}))

describe('DialerPanel', () => {
  it('falls back to the current lead page as dialer context', () => {
    const html = renderToStaticMarkup(
      <DialerPanel open onClose={() => {}} presentation="dock" />,
    )

    expect(html).toContain('Current lead')
    expect(html).toContain('/leads/24a1fd7f-a31d-41ea-aae0-7948516dd37c')
  })
})
