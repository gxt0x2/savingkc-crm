// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { NewsletterSignup } from './newsletter-signup'

const SANDBOX = 'savingkc@gmail.com'

describe('NewsletterSignup', () => {
  it('posts email, role, and county with consent', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, status: 'received', message: 'Got it. If this address can receive the newsletter, you are on the list.' }),
    }))
    vi.stubGlobal('fetch', fetchMock)
    render(<NewsletterSignup source="funnel" />)

    fireEvent.change(screen.getByLabelText('Email'), { target: { value: SANDBOX } })
    fireEvent.click(screen.getByRole('radio', { name: 'Seller' }))
    fireEvent.change(screen.getByLabelText('County'), { target: { value: 'Platte' } })
    fireEvent.click(screen.getByRole('checkbox'))
    fireEvent.click(screen.getByRole('button', { name: 'Send me the Tuesday note' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/email/newsletters/signup')
    expect(JSON.parse(String(init.body))).toEqual({
      email: SANDBOX,
      role: 'seller',
      county: 'Platte',
      consent: true,
      source: 'funnel',
    })
    expect(await screen.findByRole('status')).toHaveTextContent('you are on the list')
    vi.unstubAllGlobals()
  })
})
