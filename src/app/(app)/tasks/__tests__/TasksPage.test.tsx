/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TasksPage from '../page'
import type { Task } from '@/types'

const { refetchMock, useTaskWorklistMock } = vi.hoisted(() => ({
  refetchMock: vi.fn(),
  useTaskWorklistMock: vi.fn(),
}))

vi.mock('@/hooks/use-task-worklist', () => ({ useTaskWorklist: useTaskWorklistMock }))
vi.mock('@/components/conversations/workspace-frame', () => ({
  WorkspaceChrome: ({ commandBar }: { commandBar?: React.ReactNode }) => <header data-testid="shared-shell-header">{commandBar}</header>,
}))
vi.mock('@/components/modals/new-task-modal', () => ({ NewTaskModal: () => <div role="dialog">New task modal</div> }))
vi.mock('@/components/modals/edit-task-modal', () => ({ EditTaskModal: () => <div role="dialog">Edit task modal</div> }))
vi.mock('@/components/tasks/task-reconciliation-strip', () => ({ TaskReconciliationStrip: () => <section aria-label="Task backlog health" /> }))
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
}))

const tasks: Task[] = [
  {
    id: 'task-1',
    type: 'follow_up',
    title: 'Call seller',
    description: 'Confirm appointment time',
    contact_id: 'lead-1',
    deal_id: null,
    property_address: '123 Main St',
    due_date: '2027-07-14T13:59:00.000Z',
    assigned_to: 'Casey',
    status: 'pending',
    created_at: '2026-08-10T12:00:00.000Z',
    version: 2,
    contact: {
      id: 'lead-1', first_name: 'Michael', last_name: 'Maddox', email: null, phone: null, address: '123 Main St', city: 'Kansas City', state: 'MO', zip: null, personality_type: null, lead_score: null, lead_owner: 'Casey', smart_tags: [], current_stage: 'new', created_at: '2026-08-10T12:00:00.000Z', updated_at: '2026-08-10T12:00:00.000Z',
    },
  },
  {
    id: 'task-2',
    type: 'task',
    title: 'Review offer',
    description: null,
    contact_id: null,
    deal_id: null,
    property_address: null,
    due_date: null,
    assigned_to: 'Ernest',
    status: 'completed',
    created_at: '2026-08-09T12:00:00.000Z',
    operational_lane: 'review',
    review_reason: 'unlinked',
  },
]

describe('TasksPage operating workspace', () => {
  beforeEach(() => {
    refetchMock.mockReset()
    useTaskWorklistMock.mockReset()
    refetchMock.mockResolvedValue({ data: { tasks: [tasks[0]] } })
    useTaskWorklistMock.mockReturnValue({
      data: {
        tasks: [tasks[0]],
        counts: { all: 1, due_today: 0, overdue: 0, upcoming: 1, completed: 0 },
        laneCounts: { current: 1, review: 1, quarantine: 0, all: 2 },
        pageInfo: { limit: 20, total: 1, hasMore: false, nextCursor: null },
        serverNow: '2026-08-21T15:00:00Z',
      },
      isLoading: false, error: null, refetch: refetchMock, isFetching: false,
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, changed: 2 }) }))
  })

  it('matches the Contacts command-header pattern and exposes task smart lists', () => {
    render(<TasksPage />)

    const header = screen.getByTestId('tasks-command-header')
    expect(screen.getByTestId('shared-shell-header')).toContainElement(header)
    expect(Array.from(header.querySelectorAll('[data-header-slot]')).map((element) => element.getAttribute('data-header-slot'))).toEqual([
      'context',
      'search',
      'actions',
    ])
    expect(within(header).getByRole('textbox', { name: 'Search tasks' })).toBeInTheDocument()
    expect(within(header).getByRole('button', { name: /Add task/ })).toBeInTheDocument()
    expect(within(screen.getByRole('navigation', { name: 'Task smart lists' })).getAllByRole('button').map((button) => button.getAttribute('aria-label')?.replace(/\s\d+$/, ''))).toEqual([
      'All',
      'Due today',
      'Overdue',
      'Upcoming',
      'Completed',
    ])
  })

  it('completes a task from its status control', async () => {
    render(<TasksPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Mark Call seller complete' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/calendar/tasks/task-1', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({ status: 'completed', expectedVersion: 2 }),
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('Task completed.')
    expect(screen.getByRole('button', { name: 'Reopen Call seller' })).toBeInTheDocument()
  })

  it('confirms and deletes an individual task', async () => {
    render(<TasksPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Delete Call seller' }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText('Call seller')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/calendar/tasks/task-1', { method: 'DELETE' }))
    expect(screen.queryByRole('button', { name: /Call seller/ })).not.toBeInTheDocument()
  })

  it('applies one bulk action to selected task rows', async () => {
    render(<TasksPage />)

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select tasks on this page' }))
    const bulkBar = screen.getByRole('region', { name: 'Bulk task changes' })
    fireEvent.change(within(bulkBar).getByRole('combobox', { name: 'Bulk action' }), { target: { value: 'complete' } })
    fireEvent.click(within(bulkBar).getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(fetch).toHaveBeenCalledWith('/api/calendar/tasks/bulk', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ ids: ['task-1'], action: 'complete' }),
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('2 tasks updated.')
  })

  it('sends governed filters to the bounded server worklist', () => {
    render(<TasksPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const filters = screen.getByRole('dialog', { name: 'Task filters' })
    const taskType = within(filters).getByRole('combobox', { name: 'Task type' })

    expect(within(taskType).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Any',
      'Follow-up',
      'Callback',
      'Appointment',
      'Send Offer',
      'General',
    ])

    fireEvent.change(taskType, { target: { value: 'follow_up' } })
    expect(useTaskWorklistMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'follow_up' }))

    fireEvent.change(within(filters).getByRole('combobox', { name: 'Assignee' }), { target: { value: 'Ernest' } })
    expect(useTaskWorklistMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'follow_up', assignee: 'Ernest' }))

    fireEvent.change(taskType, { target: { value: 'general' } })
    expect(useTaskWorklistMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'general', assignee: 'Ernest' }))

    fireEvent.click(within(filters).getByRole('button', { name: 'Clear all' }))
    expect(useTaskWorklistMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'any', assignee: undefined }))
  })

  it('uses only the current server lane and removes historical lane controls', () => {
    render(<TasksPage />)

    expect(useTaskWorklistMock).toHaveBeenLastCalledWith(expect.objectContaining({ lane: 'current' }))
    expect(screen.queryByRole('button', { name: /Review debt/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Automation quarantine/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Review offer')).not.toBeInTheDocument()
  })

  it('advances with the opaque server cursor instead of slicing a downloaded task list', () => {
    useTaskWorklistMock.mockImplementation((input: { cursor?: string | null }) => ({
      data: {
        tasks: input.cursor ? [tasks[1]] : [tasks[0]],
        counts: { all: 21, due_today: 0, overdue: 0, upcoming: 20, completed: 1 },
        laneCounts: { current: 20, review: 1, quarantine: 0, all: 21 },
        pageInfo: { limit: 20, total: 21, hasMore: !input.cursor, nextCursor: input.cursor ? null : 'opaque-page-2' },
        serverNow: '2026-08-21T15:00:00Z',
      },
      isLoading: false, error: null, refetch: refetchMock, isFetching: false,
    }))

    render(<TasksPage />)
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }))

    expect(useTaskWorklistMock).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'opaque-page-2', limit: 20 }))
    expect(screen.getByText('Review offer')).toBeInTheDocument()
    expect(screen.getByText('Showing 21 to 21 of 21 results')).toBeInTheDocument()
  })
})
