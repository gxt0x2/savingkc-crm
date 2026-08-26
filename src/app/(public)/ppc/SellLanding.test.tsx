// @vitest-environment jsdom

import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SellLanding } from './SellLanding'

vi.mock('next/image', () => ({
  default: (props: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    const imageProps = { ...props }
    delete imageProps.fill
    return React.createElement('img', imageProps)
  },
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

function clickNextButton() {
  fireEvent.click(screen.getByRole('button', { name: /^Next$/ }))
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('SellLanding', () => {
  it('renders the general landing question without leaking HTML entities', () => {
    const html = renderLanding()

    expect(html).toContain('Step 1 of 4')
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
    expect(html).toContain('<strong>100+</strong> Owners helped')
    expect(html).toContain('Tell us the mess. <span class="accent-green">We bring a number.</span>')
    expect(html).toContain('Pick the problem. <span class="accent-green">We show the next step.</span>')
    expect(html).toContain('Tax letters keep coming')
    expect(html).toContain('You got a house you did not ask for')
    expect(html).toContain('The house is too much right now')
    expect(html).toContain('You do not have to <span class="accent-green">fix the house</span> first.')
    expect(html).toContain('Take what you want and leave the rest.')
    expect(html).toContain('Local KC people, not a call center.')
    expect(html).toContain('Hear from sellers who <span class="accent-green">got unstuck.</span>')
    expect(html.match(/href="#video-testimonials"/g)).toHaveLength(2)
    expect(html).toContain('id="video-testimonials"')
    expect(html).toContain('data-video-url="https://www.youtube.com/embed/bZyZYbI0sg4"')
    expect(html).toContain('data-video-url="https://www.youtube.com/embed/eA55Ehd17mI"')
    expect(html).toContain('enablejsapi=1')
    expect(html).not.toContain('autoplay=1')
    expect(html).toContain('/ppc/seller-story-cleaner-way-out.webp')
    expect(html).toContain('/ppc/seller-story-local-help.webp')
    expect(html).toContain('1:08')
    expect(html).toContain('1:29')
    expect(html).not.toContain('video-card-duration')
    expect(html).toContain('100+ KC neighbors. <span class="accent-green">All the way home.</span>')
    expect(html).toContain('Closed fast')
    expect(html).not.toContain('We know your county. And your block.')
    expect(html).not.toContain('Leave the junk. Skip the repairs.')
    expect(html).not.toContain('No SSN, no income docs')
    expect(html).not.toContain('If life put you here, we can help.')
    expect(html).not.toContain('You pay $0.')
    expect(html).toMatch(/What(?:'|&#x27;)s your situation\?/)
    expect(html).toContain('radio-tile selected"><span class="material-symbols-outlined" aria-hidden="true">gavel</span>Behind on taxes')
    expect(html).not.toContain('&amp;apos;')
  })

  it('keeps the tax landing free of escaped apostrophe entities', () => {
    const html = renderLanding('tax')

    expect(html).toContain('Step 1 of 4')
    expect(html).toContain('Are you behind on property taxes?')
    expect(html).toContain('Get My Cash Offer In 1 hour.')
    expect(html).toContain('Hear from sellers who <span class="accent-green">got unstuck.</span>')
    expect(html.match(/href="#video-testimonials"/g)).toHaveLength(2)
    expect(html).toContain('id="video-testimonials"')
    expect(html).toContain('/ppc/seller-story-cleaner-way-out.webp')
    expect(html).toContain('/ppc/seller-story-local-help.webp')
    expect(html).toContain('enablejsapi=1')
    expect(html).not.toContain('autoplay=1')
    expect(html).not.toContain('video-card-duration')
    expect(html).not.toContain('&amp;apos;')
  })

  it('renders redemption-specific form copy and option values', () => {
    const html = renderLanding('redemption')

    expect(html).toContain('Tax sale happened? <span class="accent">You may still have a move.</span>')
    expect(html).toContain('Are you trying to redeem after a tax sale?')
    expect(html).toContain('Yes, redemption window')
    expect(html).toContain('Check My Window')
    expect(html).not.toContain('&amp;apos;')
  })

  it('renders excess-proceeds-specific form copy and option values', () => {
    const html = renderLanding('excess-proceeds')

    expect(html).toContain('County may be holding money <span class="accent">after a tax sale.</span>')
    expect(html).toContain('Do you think there are excess proceeds?')
    expect(html).toContain('Yes / I received notice')
    expect(html).toContain('Check Proceeds')
    expect(html).not.toContain('&amp;apos;')
  })

  it('walks the redemption landing through auction status and redemption qualifier steps', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })))

    render(
      <SellLanding
        phoneDisplay="(816) 608-6648"
        phoneTel="+18166086648"
        variant="redemption"
      />,
    )

    expect(screen.getByText('Are you trying to redeem after a tax sale?')).toBeInTheDocument()
    clickNextButton()

    expect(screen.getByLabelText('Step 2 of 4')).toBeInTheDocument()
    expect(screen.getByText('Did the tax sale already happen?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    clickNextButton()

    expect(screen.getByLabelText('Step 3 of 4')).toBeInTheDocument()
    expect(screen.getByText('How close is the redemption deadline?')).toBeInTheDocument()
    expect(screen.getByText('What help do you need first?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Under 30 days' }))
    fireEvent.click(screen.getByRole('button', { name: 'Need payoff amount' }))
    fireEvent.click(screen.getByRole('button', { name: /Check My Redemption Path/i }))

    expect(screen.getByLabelText('Step 4 of 4')).toBeInTheDocument()
    expect(screen.getByText('Redemption review ready — finish below so we can check the property.')).toBeInTheDocument()
  })

  it('walks the excess-proceeds landing through sale status and claim qualifier steps', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })))

    render(
      <SellLanding
        phoneDisplay="(816) 608-6648"
        phoneTel="+18166086648"
        variant="excess-proceeds"
      />,
    )

    expect(screen.getByText('Do you think there are excess proceeds?')).toBeInTheDocument()
    clickNextButton()

    expect(screen.getByLabelText('Step 2 of 4')).toBeInTheDocument()
    expect(screen.getByText('Has the property already sold at tax sale?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes' }))
    clickNextButton()

    expect(screen.getByLabelText('Step 3 of 4')).toBeInTheDocument()
    expect(screen.getByText('When did the sale happen?')).toBeInTheDocument()
    expect(screen.getByText('What makes the claim hard?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Last 12 months' }))
    fireEvent.click(screen.getByRole('button', { name: 'Need claim filed' }))
    fireEvent.click(screen.getByRole('button', { name: /Check My Proceeds Path/i }))

    expect(screen.getByLabelText('Step 4 of 4')).toBeInTheDocument()
    expect(screen.getByText('Proceeds review ready — finish below so we can check the address.')).toBeInTheDocument()
  })

  it('splits the general quiz timeline and condition into separate steps', () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) })))

    render(
      <SellLanding
        phoneDisplay="(816) 608-8808"
        phoneTel="+18166088808"
      />,
    )

    expect(screen.getByLabelText('Step 1 of 4')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(screen.getByLabelText('Step 2 of 4')).toBeInTheDocument()
    expect(screen.getByText('How soon do you need to sell?').closest('.form-field')).toHaveClass('form-field-prominent')
    expect(screen.getByRole('button', { name: 'ASAP (under 30 days)' }).closest('.radio-group')).toHaveClass('prominent-choices')
    expect(screen.queryByText('Condition of the property')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'ASAP (under 30 days)' }))
    fireEvent.click(screen.getByRole('button', { name: /Next/i }))
    expect(screen.getByLabelText('Step 3 of 4')).toBeInTheDocument()
    expect(screen.getByText('Condition of the property').closest('.form-field')).toHaveClass('form-field-prominent')
    expect(screen.getByRole('button', { name: /Needs work/i }).closest('.radio-group')).toHaveClass('prominent-choices')
    expect(screen.queryByText('How soon do you need to sell?')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /Needs work/i }))
    fireEvent.click(screen.getByRole('button', { name: /See My Offer Range/i }))
    expect(screen.getByLabelText('Step 4 of 4')).toBeInTheDocument()
    expect(screen.getByLabelText('Property address')).toBeInTheDocument()
  })

  it('sends a YouTube play command on the first thumbnail press', () => {
    const postMessage = vi.fn()
    render(
      <SellLanding
        phoneDisplay="(816) 608-8808"
        phoneTel="+18166088808"
      />,
    )

    const frame = screen.getByTitle('Seller story: a cleaner way out') as HTMLIFrameElement
    Object.defineProperty(frame, 'contentWindow', {
      configurable: true,
      value: { postMessage },
    })

    const playButton = screen.getByRole('button', {
      name: 'Play Seller story: a cleaner way out, 1:08',
    })
    fireEvent.pointerDown(playButton, { button: 0 })

    expect(postMessage).toHaveBeenCalledWith(
      JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
      'https://www.youtube.com',
    )
    expect(screen.queryByRole('button', {
      name: 'Play Seller story: a cleaner way out, 1:08',
    })).not.toBeInTheDocument()
  })
})
