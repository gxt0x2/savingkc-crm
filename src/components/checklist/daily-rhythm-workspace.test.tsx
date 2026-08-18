/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DailyRhythmWorkspace } from './daily-rhythm-workspace'

describe('DailyRhythmWorkspace', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        date: '2026-08-17',
        sod: null,
        eod: null,
        purpose: { personalGoal: 'Build a family safety net', personalWhy: 'Create long-term freedom' },
        queue: [
          { id: 'task-1', leadId: 'lead-1', leadName: 'Jordan Seller', property: '123 Test St', stage: 'Lead', priority: 'High', action: 'Call', dueAt: null },
          { id: 'task-2', leadId: 'lead-2', leadName: 'Taylor Owner', property: '456 Oak Ave', stage: 'Opportunity', priority: 'Medium', action: 'Open', dueAt: null },
        ],
      }),
    }))
  })

  it('centers the morning launch and daily closeout jobs', async () => {
    render(<DailyRhythmWorkspace userEmail="casey@savingkc.com" />)

    expect(screen.getByRole('heading', { name: 'Let’s make today count, Casey.' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Morning Launch' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Daily Closeout' })).toBeVisible()
    expect(screen.getAllByText('Your Goal & Why')[0]).toBeVisible()
    expect(screen.getByText('Clear Urgent Messages')).toBeVisible()
    expect(screen.queryByText('Practice Objections')).not.toBeInTheDocument()
    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/daily-rhythm', { cache: 'no-store' }))
    expect(screen.getByDisplayValue('Build a family safety net')).toBeVisible()
    expect(screen.getByDisplayValue('Create long-term freedom')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Review Priority Sellers/ }))
    expect(screen.getByText('Top 2 priority actions')).toBeVisible()
    expect(screen.getByText('Jordan Seller')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Open Pipeline' })).toHaveAttribute('href', '/contacts?list=new')
  })

  it('submits a meaningful morning launch and advances to closeout', async () => {
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ date: '2026-08-17', sod: null, eod: null }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ commitments: [], queue: [] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ items: [] }) } as unknown as Response)
      .mockResolvedValueOnce({ ok: true, json: vi.fn().mockResolvedValue({ success: true, id: 'sod-1', submittedAt: '2026-08-17T13:00:00Z' }) } as unknown as Response)

    render(<DailyRhythmWorkspace userEmail="casey@savingkc.com" />)
    await waitFor(() => expect(screen.getByPlaceholderText('What are you working toward personally?')).toBeEnabled())
    fireEvent.change(screen.getByPlaceholderText('What are you working toward personally?'), { target: { value: 'Buy a home' } })
    fireEvent.change(screen.getByPlaceholderText('Why does this matter to you?'), { target: { value: 'Create stability for my family' } })
    fireEvent.click(screen.getByRole('button', { name: /Set Today’s Goal/ }))
    fireEvent.change(screen.getByPlaceholderText('What must happen today?'), { target: { value: 'Book two qualified appointments' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start My Day' }))

    await waitFor(() => expect(screen.getByRole('button', { name: /Daily Closeout/ })).toHaveClass('bg-[var(--crm-brand)]'))
    expect(fetchMock).toHaveBeenLastCalledWith('/api/daily-rhythm', expect.objectContaining({ method: 'POST' }))
  })
})
