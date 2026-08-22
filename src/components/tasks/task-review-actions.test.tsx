/** @vitest-environment jsdom */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TaskReviewActionGate, TaskReviewBadge } from './task-review-actions'
import type { Task } from '@/types'

const task = { operational_lane: 'review', review_reason: 'unlinked' } as Task

describe('task review actions', () => {
  it('explains why a task needs review', () => {
    render(<TaskReviewBadge task={task} />)
    expect(screen.getByText('Unlinked task')).toHaveAttribute('title', expect.stringContaining('No contact record'))
  })

  it('requires a deliberate confirmation before enabling changes', () => {
    const onChange = vi.fn()
    render(<TaskReviewActionGate enabled={false} onChange={onChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'Enable reviewed changes' }))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'I will review each change' }))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('labels automation-generated work as quarantined', () => {
    render(<TaskReviewBadge task={{ operational_lane: 'quarantine', review_reason: 'automation_source' } as Task} />)
    expect(screen.getByText('Automation quarantine')).toHaveAttribute('title', expect.stringContaining('unreviewed automation'))
  })
})
