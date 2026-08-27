/** @vitest-environment jsdom */

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getCurrentUserEmail: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NOT_FOUND') }),
  redirect: vi.fn(() => { throw new Error('REDIRECT') }),
}))

vi.mock('next/navigation', () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}))

vi.mock('@/lib/auth/admin', () => ({
  getCurrentUserEmail: mocks.getCurrentUserEmail,
}))

vi.mock('@/components/scorecard/scorecard-results-page', () => ({
  ScorecardResultsPage: ({ initialExpandedId }: { initialExpandedId: string | null }) => (
    <main data-testid="scorecard-results" data-review-id={initialExpandedId ?? ''}>Scorecard results</main>
  ),
}))

import ScorecardPage from './page'

describe('Scorecard page access', () => {
  beforeEach(() => vi.clearAllMocks())

  it.each(['ernest@savingkc.com', 'gertha@savingkc.com'])('renders for explicit reviewer %s', async (email) => {
    mocks.getCurrentUserEmail.mockResolvedValue(email)

    render(await ScorecardPage({ searchParams: Promise.resolve({ review: 'call-42' }) }))

    expect(screen.getByTestId('scorecard-results')).toHaveAttribute('data-review-id', 'call-42')
  })

  it('returns not found for Casey', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue('casey@savingkc.com')

    await expect(ScorecardPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND')
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })

  it('redirects an unauthenticated user to login', async () => {
    mocks.getCurrentUserEmail.mockResolvedValue(null)

    await expect(ScorecardPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledWith('/login?redirect=/scorecard')
  })
})
