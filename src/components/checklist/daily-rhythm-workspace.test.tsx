/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DailyRhythmWorkspace } from './daily-rhythm-workspace'

describe('DailyRhythmWorkspace', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ date: '2026-08-17', sod: null, eod: null }),
    }))
  })

  it('centers the morning launch and daily closeout jobs', async () => {
    render(<DailyRhythmWorkspace userEmail="casey@savingkc.com" />)

    expect(screen.getByRole('heading', { name: 'Start strong. Finish clean.' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Morning Launch' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Daily Closeout' })).toBeVisible()
    expect(screen.getByText('Review Vision')).toBeVisible()
    expect(screen.getByText('Practice Objections')).toBeVisible()
    expect(screen.getByText('Review Follow-Ups')).toBeVisible()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/daily-rhythm', { cache: 'no-store' }))
  })

  it('submits a meaningful morning launch and advances to closeout', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ date: '2026-08-17', sod: null, eod: null }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ success: true, id: 'sod-1', submittedAt: '2026-08-17T13:00:00Z' }) } as unknown as Response)

    render(<DailyRhythmWorkspace userEmail="casey@savingkc.com" />)
    const opportunityStep = screen.getByRole('button', { name: /Review Vision/ })
    await waitFor(() => expect(opportunityStep).toBeEnabled())
    fireEvent.click(opportunityStep)
    fireEvent.change(screen.getByPlaceholderText('What must happen today?'), { target: { value: 'Book two qualified appointments' } })
    const launchButton = screen.getByRole('button', { name: /Launch my day/ })
    await waitFor(() => expect(launchButton).toBeEnabled())
    fireEvent.click(launchButton)

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Close the day' })).toBeVisible())
    expect(fetchMock).toHaveBeenLastCalledWith('/api/daily-rhythm', expect.objectContaining({ method: 'POST' }))
  })
})
