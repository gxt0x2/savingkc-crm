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

    expect(html).toContain('Sell My House In <span class="accent">Kansas City</span> Today.')
    expect(html).toContain('Back taxes. An inherited headache. A tenant who won’t leave. Repairs that never end.')
    expect(html).toContain('Whatever stress you’re facing, you don’t have to fix it, clean it, or explain it. Just give us the address and we’ll bring you a fair cash offer in under an hour. You pick the closing date.')
    expect(html).not.toContain('A house you didn&#x27;t ask for.')
    expect(html).toContain('wb_sunny')
    expect(html).toContain('The <span class="em">fresh start</span> you&#x27;ve been waiting for.')
    expect(html).toContain('$0 due before you sell.')
    expect(html).toContain('100% private.')
    expect(html).toContain('Close in 7-60 days')
    expect(html).toContain('Back taxes paid at closing.')
    expect(html).toContain('Tell us the mess. <span class="accent-green">We bring a number.</span>')
    expect(html).toContain('Pick the problem. <span class="accent-green">We show the next step.</span>')
    expect(html).toContain('Tax letters keep coming')
    expect(html).toContain('You got a house you did not ask for')
    expect(html).toContain('The house is too much right now')
    expect(html).toContain('You do not have to <span class="accent-green">fix the house</span> first.')
    expect(html).toContain('Local KC people, not a call center.')
    expect(html).not.toContain('No SSN, no income docs')
    expect(html).not.toContain('If life put you here, we can help.')
    expect(html).not.toContain('You pay $0.')
    expect(html).toMatch(/What(?:'|&#x27;)s your situation\?/)
    expect(html).toContain('radio-tile selected"><span class="material-symbols-outlined" aria-hidden="true">gavel</span>Behind on taxes')
    expect(html).not.toContain('&amp;apos;')
  })

  it('keeps the tax landing free of escaped apostrophe entities', () => {
    const html = renderLanding('tax')

    expect(html).toContain('Are you behind on property taxes?')
    expect(html).toContain('Get My Cash Offer In 1 hour.')
    expect(html).not.toContain('&amp;apos;')
  })
})
