import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SellLanding } from './SellLanding'

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => React.createElement('img', props),
}))

function renderLanding(variant?: React.ComponentProps<typeof SellLanding>['variant']) {
  return renderToStaticMarkup(
    <SellLanding
      phoneDisplay="(816) 608-8808"
      phoneTel="+18166088808"
      variant={variant}
    />,
  )
}

describe('SellLanding', () => {
  it('renders the general landing question without leaking HTML entities', () => {
    const html = renderLanding()

    expect(html).toMatch(/What(?:'|&#x27;)s your situation\?/)
    expect(html).not.toContain('&amp;apos;')
  })

  it('keeps the tax landing free of escaped apostrophe entities', () => {
    const html = renderLanding('tax')

    expect(html).toContain('Are you behind on property taxes?')
    expect(html).not.toContain('&amp;apos;')
  })
})
