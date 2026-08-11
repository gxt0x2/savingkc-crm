/** @vitest-environment jsdom */
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import TasksPage from '../page'
import type { Task } from '@/types'

const { refetchMock, useCalendarTasksMock } = vi.hoisted(() => ({
  refetchMock: vi.fn(),
  useCalendarTasksMock: vi.fn(),
}))

vi.mock('@/hooks/use-calendar-tasks', () => ({ useCalendarTasks: useCalendarTasksMock }))
vi.mock('@/components/conversations/workspace-frame', () => ({
  WorkspaceChrome: ({ commandBar }: { commandBar?: React.ReactNode }) => <header data-testid="shared-shell-header">{commandBar}</header>,
}))
vi.mock('@/components/modals/new-task-modal', () => ({ NewTaskModal: () => <div role="dialog">New task modal</div> }))
vi.mock('@/components/modals/edit-task-modal', () => ({ EditTaskModal: () => <div role="dialog">Edit task modal</div> }))
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
  },
]

describe('TasksPage operating workspace', () => {
  beforeEach(() => {
    refetchMock.mockResolvedValue({ data: tasks })
    useCalendarTasksMock.mockReturnValue({ data: tasks, isLoading: false, error: null, refetch: refetchMock, isFetching: false })
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
      body: JSON.stringify({ status: 'completed' }),
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
      body: JSON.stringify({ ids: ['task-1', 'task-2'], action: 'complete' }),
    })))
    expect(await screen.findByRole('status')).toHaveTextContent('2 tasks updated.')
  })

  it('filters by the governed task types and combines with other task filters', () => {
    render(<TasksPage />)

    fireEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const filters = screen.getByRole('dialog', { name: 'Task filters' })
    const taskType = within(filters).getByRole('combobox', { name: 'Task type' })

    expect(within(taskType).getAllByRole('option').map((option) => option.textContent)).toEqual([
      'Any',
      'Follow-up',
      'Callback',
      'Appointment',
      'Research',
      'Send Offer',
      'General',
    ])

    fireEvent.change(taskType, { target: { value: 'follow_up' } })
    expect(screen.getByText('Call seller')).toBeInTheDocument()
    expect(screen.queryByText('Review offer')).not.toBeInTheDocument()

    fireEvent.change(within(filters).getByRole('combobox', { name: 'Assignee' }), { target: { value: 'Ernest' } })
    expect(screen.getByText('No tasks match this view')).toBeInTheDocument()

    fireEvent.change(taskType, { target: { value: 'general' } })
    expect(screen.getByText('Review offer')).toBeInTheDocument()
    expect(screen.queryByText('Call seller')).not.toBeInTheDocument()

    fireEvent.click(within(filters).getByRole('button', { name: 'Clear all' }))
    expect(screen.getByText('Call seller')).toBeInTheDocument()
    expect(screen.getByText('Review offer')).toBeInTheDocument()
  })
})
