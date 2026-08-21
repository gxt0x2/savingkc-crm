'use client'

import Link from 'next/link'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'

import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { EditTaskModal } from '@/components/modals/edit-task-modal'
import { NewTaskModal } from '@/components/modals/new-task-modal'
import { Icon } from '@/components/ui/icon'
import { useTaskWorklist } from '@/hooks/use-task-worklist'
import { useMobileViewport } from '@/hooks/use-mobile-viewport'
import type { Task, TaskStatus } from '@/types'

type TaskView = 'all' | 'due_today' | 'overdue' | 'upcoming' | 'completed'
type TaskStatusFilter = 'all' | 'active' | 'completed'
type TaskDueFilter = 'any' | 'no_due' | 'seven_days' | 'thirty_days'
type TaskTypeFilter = 'any' | 'follow_up' | 'callback' | 'appointment' | 'offer' | 'general'
type TaskSort = 'due_asc' | 'due_desc' | 'newest' | 'title'
type ToolbarMenu = 'filters' | 'sort' | null
type BulkAction = '' | 'complete' | 'reopen' | 'delete' | `assign:${string}`
type DeleteRequest = { kind: 'single' | 'bulk'; ids: string[]; label: string }

const PAGE_SIZE = 20
const EMPTY_TASKS: Task[] = []
const ASSIGNEES = ['Casey', 'Ernest', 'Gertha'] as const
const TASK_TYPE_FILTER_OPTIONS: Array<[Exclude<TaskTypeFilter, 'any'>, string]> = [
  ['follow_up', 'Follow-up'],
  ['callback', 'Callback'],
  ['appointment', 'Appointment'],
  ['offer', 'Send Offer'],
  ['general', 'General'],
]

const TASK_VIEW_COPY: Record<TaskView, { label: string; description: string }> = {
  all: { label: 'All', description: 'Every acquisition task, including completed work.' },
  due_today: { label: 'Due today', description: 'Work that must be completed before today ends.' },
  overdue: { label: 'Overdue', description: 'Open tasks past their recorded due date.' },
  upcoming: { label: 'Upcoming', description: 'Scheduled work due after today.' },
  completed: { label: 'Completed', description: 'Closed tasks retained for accountability and history.' },
}

function isTaskOverdue(task: Task, timestamp: number) {
  if (task.status === 'completed') return false
  const due = task.due_date ? new Date(task.due_date).getTime() : null
  return task.status === 'overdue' || (due !== null && due < timestamp)
}

function contactName(task: Task) {
  return [task.contact?.first_name, task.contact?.last_name].filter(Boolean).join(' ') || 'Not linked'
}

function assigneeInitials(value: string | null) {
  if (!value) return '—'
  return value.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
}

function dueLabel(task: Task) {
  if (!task.due_date) return 'No due date'
  return new Date(task.due_date).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export default function TasksPage() {
  const isMobile = useMobileViewport()
  const [view, setView] = useState<TaskView>('all')
  const [search, setSearch] = useState('')
  const [assigneeFilter, setAssigneeFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>('all')
  const [dueFilter, setDueFilter] = useState<TaskDueFilter>('any')
  const [taskTypeFilter, setTaskTypeFilter] = useState<TaskTypeFilter>('any')
  const [sortBy, setSortBy] = useState<TaskSort>('due_asc')
  const [toolbarMenu, setToolbarMenu] = useState<ToolbarMenu>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkAction, setBulkAction] = useState<BulkAction>('')
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set())
  const [bulkSaving, setBulkSaving] = useState(false)
  const [message, setMessage] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [statusOverrides, setStatusOverrides] = useState<Record<string, TaskStatus>>({})
  const [assigneeOverrides, setAssigneeOverrides] = useState<Record<string, string | null>>({})
  const [hiddenTaskIds, setHiddenTaskIds] = useState<Set<string>>(new Set())
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [deleteRequest, setDeleteRequest] = useState<DeleteRequest | null>(null)
  const [pagination, setPagination] = useState<{ key: string; cursors: Array<string | null> }>({ key: '', cursors: [null] })
  const [now] = useState(() => Date.now())

  const deferredSearch = useDeferredValue(search.trim())
  const serverSearch = deferredSearch.length >= 3 ? deferredSearch : ''
  const filterKey = JSON.stringify([view, assigneeFilter, statusFilter, dueFilter, taskTypeFilter, sortBy, serverSearch])
  const activeCursors = pagination.key === filterKey ? pagination.cursors : [null]
  const currentPage = activeCursors.length
  const cursor = activeCursors[activeCursors.length - 1]
  const { data, isLoading, error, refetch, isFetching } = useTaskWorklist({
    department: 'acquisitions', view, status: statusFilter, assignee: assigneeFilter || undefined,
    due: dueFilter, type: taskTypeFilter, query: serverSearch || undefined, sort: sortBy, limit: PAGE_SIZE, cursor,
  })
  const sourceTasks = data?.tasks ?? EMPTY_TASKS
  const counts = data?.counts ?? { all: 0, due_today: 0, overdue: 0, upcoming: 0, completed: 0 }
  const filteredTotal = data?.pageInfo.total ?? 0
  const countLabel = (id: TaskView) => data ? counts[id] : '—'

  const tasks = useMemo(() => sourceTasks
    .filter((task) => !hiddenTaskIds.has(task.id))
    .map((task) => ({
      ...task,
      status: statusOverrides[task.id] ?? task.status,
      assigned_to: Object.prototype.hasOwnProperty.call(assigneeOverrides, task.id)
        ? assigneeOverrides[task.id]
        : task.assigned_to,
    })), [assigneeOverrides, hiddenTaskIds, sourceTasks, statusOverrides])

  useEffect(() => {
    // Reconcile optimistic mutations after the server query catches up.
    setStatusOverrides((current) => {
      const next = { ...current }
      let changed = false
      for (const task of sourceTasks) {
        if (next[task.id] === task.status) {
          delete next[task.id]
          changed = true
        }
      }
      return changed ? next : current
    })
    setAssigneeOverrides((current) => {
      const next = { ...current }
      let changed = false
      for (const task of sourceTasks) {
        if (Object.prototype.hasOwnProperty.call(next, task.id) && next[task.id] === task.assigned_to) {
          delete next[task.id]
          changed = true
        }
      }
      return changed ? next : current
    })
    setHiddenTaskIds((current) => {
      if (current.size === 0) return current
      const sourceIds = new Set(sourceTasks.map((task) => task.id))
      const next = new Set([...current].filter((id) => sourceIds.has(id)))
      return next.size === current.size ? current : next
    })
  }, [sourceTasks])

  const pageCount = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE))
  const pageTasks = tasks
  const pageItemsSelected = pageTasks.length > 0 && pageTasks.every((task) => selectedIds.has(task.id))
  const activeFilterCount = [assigneeFilter, statusFilter !== 'all' ? statusFilter : '', dueFilter !== 'any' ? dueFilter : '', taskTypeFilter !== 'any' ? taskTypeFilter : ''].filter(Boolean).length
  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) || null : null
  const editingTask = editingTaskId ? tasks.find((task) => task.id === editingTaskId) || null : null
  const viewCopy = TASK_VIEW_COPY[view]

  function resetPosition() {
    setPagination({ key: '', cursors: [null] })
    setSelectedIds(new Set())
  }

  async function refreshWorklist() {
    if (currentPage > 1) {
      resetPosition()
      return
    }
    await refetch()
  }

  function selectView(nextView: TaskView) {
    setView(nextView)
    resetPosition()
    setMessage(null)
  }

  function togglePageSelection() {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (pageItemsSelected) pageTasks.forEach((task) => next.delete(task.id))
      else pageTasks.forEach((task) => next.add(task.id))
      return next
    })
  }

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function updateTask(id: string, update: { status?: 'pending' | 'completed'; assignedTo?: string | null }) {
    setBusyIds((current) => new Set(current).add(id))
    setMessage(null)
    const previousStatus = statusOverrides[id]
    const hadAssigneeOverride = Object.prototype.hasOwnProperty.call(assigneeOverrides, id)
    const previousAssignee = assigneeOverrides[id]
    if (update.status) setStatusOverrides((current) => ({ ...current, [id]: update.status as TaskStatus }))
    if ('assignedTo' in update) setAssigneeOverrides((current) => ({ ...current, [id]: update.assignedTo ?? null }))

    try {
      const expectedVersion = tasks.find((task) => task.id === id)?.version
      const response = await fetch(`/api/calendar/tasks/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...update, expectedVersion }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Task could not be updated')
      setMessage({ tone: 'success', text: update.status === 'completed' ? 'Task completed.' : update.status === 'pending' ? 'Task reopened.' : 'Task updated.' })
      await refreshWorklist()
    } catch (mutationError) {
      setStatusOverrides((current) => {
        const next = { ...current }
        if (previousStatus === undefined) delete next[id]
        else next[id] = previousStatus
        return next
      })
      setAssigneeOverrides((current) => {
        const next = { ...current }
        if (!hadAssigneeOverride) delete next[id]
        else next[id] = previousAssignee
        return next
      })
      setMessage({ tone: 'error', text: mutationError instanceof Error ? mutationError.message : 'Task could not be updated' })
    } finally {
      setBusyIds((current) => {
        const next = new Set(current)
        next.delete(id)
        return next
      })
    }
  }

  async function applyBulkAction() {
    if (!bulkAction || selectedIds.size === 0) return
    const ids = [...selectedIds]
    if (bulkAction === 'delete') {
      setDeleteRequest({ kind: 'bulk', ids, label: `${ids.length} selected tasks` })
      return
    }

    const action = bulkAction.startsWith('assign:') ? 'assign' : bulkAction
    const assignedTo = bulkAction.startsWith('assign:')
      ? bulkAction.slice('assign:'.length) || null
      : undefined
    setBulkSaving(true)
    setMessage(null)
    if (action === 'complete' || action === 'reopen') {
      const status = action === 'complete' ? 'completed' : 'pending'
      setStatusOverrides((current) => ids.reduce((next, id) => ({ ...next, [id]: status }), { ...current }))
    }
    if (action === 'assign') {
      setAssigneeOverrides((current) => ids.reduce((next, id) => ({ ...next, [id]: assignedTo ?? null }), { ...current }))
    }

    try {
      const response = await fetch('/api/calendar/tasks/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, action, assignedTo }),
      })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Bulk task change failed')
      setMessage({ tone: 'success', text: `${payload.changed} task${payload.changed === 1 ? '' : 's'} updated.` })
      setSelectedIds(new Set())
      setBulkAction('')
      await refreshWorklist()
    } catch (mutationError) {
      setStatusOverrides((current) => {
        const next = { ...current }
        ids.forEach((id) => delete next[id])
        return next
      })
      setAssigneeOverrides((current) => {
        const next = { ...current }
        ids.forEach((id) => delete next[id])
        return next
      })
      setMessage({ tone: 'error', text: mutationError instanceof Error ? mutationError.message : 'Bulk task change failed' })
    } finally {
      setBulkSaving(false)
    }
  }

  async function confirmDelete() {
    if (!deleteRequest) return
    const request = deleteRequest
    setDeleteRequest(null)
    setMessage(null)
    if (request.kind === 'single') setBusyIds((current) => new Set(current).add(request.ids[0]))
    else setBulkSaving(true)
    setHiddenTaskIds((current) => new Set([...current, ...request.ids]))

    try {
      const response = request.kind === 'single'
        ? await fetch(`/api/calendar/tasks/${request.ids[0]}`, { method: 'DELETE' })
        : await fetch('/api/calendar/tasks/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ids: request.ids, action: 'delete' }),
          })
      const payload = await response.json()
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Task deletion failed')
      setSelectedIds((current) => new Set([...current].filter((id) => !request.ids.includes(id))))
      setSelectedTaskId(null)
      setMessage({ tone: 'success', text: `${request.ids.length} task${request.ids.length === 1 ? '' : 's'} deleted.` })
      setBulkAction('')
      await refreshWorklist()
    } catch (mutationError) {
      setHiddenTaskIds((current) => new Set([...current].filter((id) => !request.ids.includes(id))))
      setMessage({ tone: 'error', text: mutationError instanceof Error ? mutationError.message : 'Task deletion failed' })
    } finally {
      if (request.kind === 'single') {
        setBusyIds((current) => {
          const next = new Set(current)
          next.delete(request.ids[0])
          return next
        })
      } else setBulkSaving(false)
    }
  }

  const commandBar = (
    <div data-testid="tasks-command-header" className="grid min-w-0 grid-cols-[1fr_auto] items-center gap-2 md:gap-3 lg:grid-cols-[minmax(11rem,1fr)_minmax(13rem,26rem)_auto]">
      <div data-header-slot="context" className="min-w-0">
        <p className="crm-eyebrow hidden md:block">Tasks smart list</p>
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl font-bold tracking-[-0.02em] text-[var(--crm-ink)]">{viewCopy.label}</h1>
          <span className="rounded-full bg-[var(--crm-info-soft)] px-2 py-0.5 text-xs font-bold text-[var(--crm-info)]">{countLabel(view)}</span>
        </div>
        <p className="hidden truncate text-[11px] text-[var(--crm-text-muted)] md:block" title={viewCopy.description}>{viewCopy.description}</p>
      </div>
      <label data-header-slot="search" className="relative col-span-2 min-w-0 lg:col-span-1">
        <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--crm-text-muted)]" />
        <input aria-label="Search tasks" title="Enter at least 3 characters to search" value={search} onChange={(event) => { setSearch(event.target.value); resetPosition() }} placeholder="Search tasks..." className="crm-field h-10 w-full rounded-lg pl-9 pr-3 text-sm outline-none" />
      </label>
      <div data-header-slot="actions" className="col-start-2 row-start-1 flex justify-end gap-2 lg:col-auto lg:row-auto">
        <Link href="/calendar?department=acquisitions" className="crm-secondary-button hidden h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold md:flex"><Icon name="calendar_month" />Calendar</Link>
        <button type="button" onClick={() => setNewTaskOpen(true)} aria-label="Add task" className="crm-primary-button flex h-10 w-10 items-center justify-center rounded-lg text-sm font-semibold md:w-auto md:gap-2 md:px-5"><Icon name="add" /><span className="hidden md:inline">Add task</span></button>
      </div>
    </div>
  )

  return (
    <>
      <WorkspaceChrome commandBar={commandBar} />
      <main className="min-h-full min-w-0 bg-[var(--crm-canvas)]">
        {!isMobile ? <div className="flex items-stretch border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-7">
          <nav className="flex min-w-0 flex-1 items-stretch gap-1 overflow-x-auto" aria-label="Task smart lists">
            {(Object.keys(TASK_VIEW_COPY) as TaskView[]).map((id) => (
              <button key={id} type="button" aria-current={view === id ? 'page' : undefined} aria-label={`${TASK_VIEW_COPY[id].label} ${countLabel(id)}`} onClick={() => selectView(id)} className={`flex shrink-0 items-center gap-2 border-b-2 px-4 py-4 text-sm font-semibold transition-colors ${view === id ? 'border-[var(--crm-brand)] text-[var(--crm-brand)]' : 'border-transparent text-[var(--crm-text-muted)] hover:text-[var(--crm-ink)]'}`}>
                <Icon name={id === 'all' ? 'list' : id === 'due_today' ? 'today' : id === 'overdue' ? 'notification_important' : id === 'upcoming' ? 'event_upcoming' : 'task_alt'} className="text-[17px]" />
                {TASK_VIEW_COPY[id].label}<span className="rounded-full bg-[var(--crm-surface-subtle)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--crm-text-muted)]">{countLabel(id)}</span>
              </button>
            ))}
          </nav>
        </div> : <label className="flex items-center gap-3 border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 py-2"><span className="text-xs font-bold text-[var(--crm-text-muted)]">View</span><select aria-label="Task view" value={view} onChange={(event) => selectView(event.target.value as TaskView)} className="crm-field h-10 min-w-0 flex-1 rounded-xl px-3 text-base font-bold">{(Object.keys(TASK_VIEW_COPY) as TaskView[]).map((id) => <option key={id} value={id}>{TASK_VIEW_COPY[id].label} ({countLabel(id)})</option>)}</select></label>}

        <section className="px-3 py-3 md:px-7">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative hidden sm:block">
              <button type="button" aria-label="Filters" onClick={() => setToolbarMenu((current) => current === 'filters' ? null : 'filters')} aria-expanded={toolbarMenu === 'filters'} className={`crm-secondary-button flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold ${activeFilterCount ? 'border-[var(--crm-brand-border)] text-[var(--crm-brand)]' : ''}`}><Icon name="filter_alt" className="text-[16px]" />Filters{activeFilterCount ? <span className="rounded-full bg-[var(--crm-brand)] px-1.5 py-0.5 text-[10px] text-white">{activeFilterCount}</span> : null}</button>
              {toolbarMenu === 'filters' ? <div role="dialog" aria-label="Task filters" className="crm-panel absolute left-0 top-11 z-40 w-[min(30rem,calc(100vw-3rem))] rounded-xl p-4 shadow-xl">
                <div className="mb-3 flex items-center justify-between"><div><h2 className="text-sm font-bold">Filters</h2><p className="text-xs text-[var(--crm-text-muted)]">Narrow this smart list without taking over the page.</p></div><button type="button" onClick={() => setToolbarMenu(null)} aria-label="Close filters" className="crm-icon-button flex h-8 w-8 items-center justify-center rounded-lg"><Icon name="close" /></button></div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TaskFilterSelect label="Assignee" value={assigneeFilter} onChange={(value) => { setAssigneeFilter(value); resetPosition() }} options={[["__unassigned", "Unassigned"], ...ASSIGNEES.map((name) => [name, name] as [string, string])]} />
                  <TaskFilterSelect label="Status" value={statusFilter === 'all' ? '' : statusFilter} onChange={(value) => { setStatusFilter((value || 'all') as TaskStatusFilter); resetPosition() }} options={[["active", "Active"], ["completed", "Completed"]]} />
                  <TaskFilterSelect label="Due date" value={dueFilter === 'any' ? '' : dueFilter} onChange={(value) => { setDueFilter((value || 'any') as TaskDueFilter); resetPosition() }} options={[["no_due", "No due date"], ["seven_days", "Next 7 days"], ["thirty_days", "Next 30 days"]]} />
                  <TaskFilterSelect label="Task type" value={taskTypeFilter === 'any' ? '' : taskTypeFilter} onChange={(value) => { setTaskTypeFilter((value || 'any') as TaskTypeFilter); resetPosition() }} options={TASK_TYPE_FILTER_OPTIONS} />
                </div>
                <div className="mt-4 flex justify-end border-t border-[var(--crm-border)] pt-3"><button type="button" onClick={() => { setAssigneeFilter(''); setStatusFilter('all'); setDueFilter('any'); setTaskTypeFilter('any'); resetPosition() }} className="text-xs font-bold text-[var(--crm-brand)] hover:underline">Clear all</button></div>
              </div> : null}
            </div>
            <div className="relative hidden sm:block">
              <button type="button" aria-label="Sort" onClick={() => setToolbarMenu((current) => current === 'sort' ? null : 'sort')} aria-expanded={toolbarMenu === 'sort'} className="crm-secondary-button flex h-9 items-center gap-1.5 rounded-full px-3 text-xs font-semibold"><Icon name="swap_vert" className="text-[16px]" />Sort</button>
              {toolbarMenu === 'sort' ? <div role="dialog" aria-label="Sort tasks" className="crm-panel absolute left-0 top-11 z-40 w-56 rounded-xl p-2 shadow-xl">
                {([['due_asc', 'Due date: soonest'], ['due_desc', 'Due date: latest'], ['newest', 'Recently created'], ['title', 'Title A–Z']] as const).map(([value, label]) => <button key={value} type="button" onClick={() => { setSortBy(value); setToolbarMenu(null); resetPosition() }} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-xs font-semibold ${sortBy === value ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : 'hover:bg-[var(--crm-surface-subtle)]'}`}>{label}{sortBy === value ? <Icon name="check" className="text-[16px]" /> : null}</button>)}
              </div> : null}
            </div>
            <button type="button" onClick={() => void refreshWorklist()} aria-label="Refresh tasks" className="crm-icon-button hidden h-9 w-9 items-center justify-center rounded-full sm:flex"><Icon name="refresh" className={isFetching ? 'animate-spin' : ''} /></button>
            {activeFilterCount ? <button type="button" onClick={() => { setAssigneeFilter(''); setStatusFilter('all'); setDueFilter('any'); setTaskTypeFilter('any'); resetPosition() }} className="rounded-full border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-3 py-1.5 text-xs font-semibold text-[var(--crm-brand)]">Clear ×</button> : null}
            <span className="ml-auto text-sm text-[var(--crm-text-muted)]">{data ? `${filteredTotal} results` : isLoading ? 'Loading results…' : 'Results unavailable'}</span>
          </div>

          {selectedIds.size > 0 ? <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] px-3 py-2.5" role="region" aria-label="Bulk task changes">
            <span className="mr-1 text-sm font-black text-[var(--crm-info)]">{selectedIds.size} selected</span>
            <select aria-label="Bulk action" value={bulkAction} onChange={(event) => setBulkAction(event.target.value as BulkAction)} className="crm-field h-9 min-w-52 rounded-lg px-3 text-xs font-semibold">
              <option value="">Choose bulk action…</option>
              <option value="complete">Mark completed</option>
              <option value="reopen">Reopen</option>
              <optgroup label="Assign owner">
                {ASSIGNEES.map((name) => <option key={name} value={`assign:${name}`}>Assign to {name}</option>)}
                <option value="assign:">Set unassigned</option>
              </optgroup>
              <option value="delete">Delete tasks…</option>
            </select>
            <button type="button" onClick={() => void applyBulkAction()} disabled={!bulkAction || bulkSaving} className="crm-primary-button h-9 rounded-lg px-4 text-xs font-black disabled:cursor-not-allowed disabled:opacity-45">{bulkSaving ? 'Applying…' : 'Apply'}</button>
            <button type="button" onClick={() => { setSelectedIds(new Set()); setBulkAction('') }} disabled={bulkSaving} className="crm-secondary-button h-9 rounded-lg px-3 text-xs font-bold">Clear selection</button>
          </div> : null}

          {message ? <div role="status" className={`mt-3 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-bold ${message.tone === 'error' ? 'border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]'}`}><Icon name={message.tone === 'error' ? 'error' : 'check_circle'} className="text-[17px]" />{message.text}</div> : null}

          {!isMobile ? <div className="crm-panel mt-3 overflow-x-auto rounded-xl">
            <div className="crm-table-header grid min-w-[1120px] grid-cols-[2rem_3rem_1.05fr_1.25fr_1fr_.75fr_1fr_5rem] items-center gap-3 border-b px-3 py-3 text-[11px] font-bold uppercase tracking-[0.06em]">
              <input type="checkbox" aria-label="Select tasks on this page" checked={pageItemsSelected} onChange={togglePageSelection} className="h-4 w-4 accent-[var(--crm-brand)]" />
              <span>Status</span><span>Title</span><span>Description</span><span>Associated contact</span><span>Assignee</span><span>Due date</span><span className="text-right">Actions</span>
            </div>
            {isLoading ? <TaskSkeleton /> : null}
            {error ? <div className="p-8 text-center text-sm text-[var(--crm-danger)]">Tasks could not be loaded. <button type="button" onClick={() => void refetch()} className="font-bold underline">Try again</button></div> : null}
            {!isLoading && !error && pageTasks.length === 0 ? <div className="p-12 text-center"><Icon name="task_alt" className="text-4xl text-[var(--crm-text-muted)]" /><h2 className="mt-2 text-sm font-black">No tasks match this view</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Adjust the smart list or filters, or add a task.</p></div> : null}
            {!isLoading && !error ? pageTasks.map((task) => {
              const overdue = isTaskOverdue(task, now)
              const busy = busyIds.has(task.id)
              const completed = task.status === 'completed'
              const name = contactName(task)
              return <div key={task.id} className={`grid min-w-[1120px] grid-cols-[2rem_3rem_1.05fr_1.25fr_1fr_.75fr_1fr_5rem] items-center gap-3 border-b border-l-4 border-b-[var(--crm-border)] px-3 py-3.5 text-xs last:border-b-0 ${completed ? 'border-l-[var(--crm-success)] bg-[var(--crm-success-soft)]/30' : overdue ? 'border-l-[var(--crm-brand)]' : 'border-l-transparent hover:bg-[var(--crm-surface-subtle)]'}`}>
                <input type="checkbox" aria-label={`Select ${task.title}`} checked={selectedIds.has(task.id)} onChange={() => toggleSelected(task.id)} className="h-4 w-4 accent-[var(--crm-brand)]" />
                <button type="button" disabled={busy} onClick={() => void updateTask(task.id, { status: completed ? 'pending' : 'completed' })} aria-label={completed ? `Reopen ${task.title}` : `Mark ${task.title} complete`} title={completed ? 'Reopen task' : 'Mark complete'} className={`flex h-8 w-8 items-center justify-center rounded-full border-2 transition-colors disabled:opacity-45 ${completed ? 'border-[var(--crm-success)] bg-[var(--crm-success)] text-white' : overdue ? 'border-[var(--crm-danger)] text-[var(--crm-danger)] hover:bg-[var(--crm-danger-soft)]' : 'border-[var(--crm-border-strong)] text-[var(--crm-text-muted)] hover:border-[var(--crm-success)] hover:bg-[var(--crm-success-soft)] hover:text-[var(--crm-success)]'}`}><Icon name={busy ? 'progress_activity' : 'check'} className={`text-[17px] ${busy ? 'animate-spin' : ''}`} /></button>
                <button type="button" onClick={() => setSelectedTaskId(task.id)} className="min-w-0 text-left"><strong className={`block truncate text-sm ${completed ? 'text-[var(--crm-text-muted)] line-through' : 'text-[var(--crm-ink)]'} hover:text-[var(--crm-brand)] hover:underline`}>{task.title}</strong><small className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--crm-text-muted)]">{task.type.replaceAll('_', ' ')}</small></button>
                <span className="truncate text-[var(--crm-text-muted)]" title={task.description || 'No description'}>{task.description || 'No description'}</span>
                <span className="min-w-0">{task.contact_id ? <Link href={`/leads/${task.contact_id}`} prefetch={false} className="block truncate font-bold text-[var(--crm-info)] hover:underline">{name}</Link> : <strong className="block truncate text-[var(--crm-text-muted)]">{name}</strong>}<small className="mt-0.5 block truncate text-[var(--crm-text-muted)]">{task.property_address || 'No property linked'}</small></span>
                <span className="flex min-w-0 items-center gap-2"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[var(--crm-info-soft)] text-[10px] font-black text-[var(--crm-info)]">{assigneeInitials(task.assigned_to)}</span><span className="truncate font-semibold">{task.assigned_to || 'Unassigned'}</span></span>
                <span className={`flex items-center gap-1.5 font-semibold ${overdue ? 'text-[var(--crm-danger)]' : completed ? 'text-[var(--crm-success)]' : 'text-[var(--crm-text)]'}`}><Icon name={completed ? 'check_circle' : overdue ? 'error' : 'event'} className="text-[16px]" />{dueLabel(task)}</span>
                <span className="flex justify-end gap-1"><button type="button" onClick={() => setEditingTaskId(task.id)} aria-label={`Edit ${task.title}`} title="Edit task" className="crm-icon-button flex h-8 w-8 items-center justify-center rounded-lg"><Icon name="edit" className="text-[17px]" /></button><button type="button" onClick={() => setDeleteRequest({ kind: 'single', ids: [task.id], label: task.title })} aria-label={`Delete ${task.title}`} title="Delete task" className="crm-icon-button flex h-8 w-8 items-center justify-center rounded-lg hover:!border-[var(--crm-danger-border)] hover:!bg-[var(--crm-danger-soft)] hover:!text-[var(--crm-danger)]"><Icon name="delete" className="text-[17px]" /></button></span>
              </div>
            }) : null}
          </div> : <div className="mt-3 space-y-2" aria-label="Tasks">
            {isLoading ? <div className="crm-panel rounded-xl p-5 text-sm text-[var(--crm-text-muted)]">Loading tasks…</div> : null}
            {error ? <div className="crm-panel rounded-xl p-5 text-sm text-[var(--crm-danger)]">Tasks could not be loaded. <button type="button" onClick={() => void refetch()} className="font-bold underline">Try again</button></div> : null}
            {!isLoading && !error && pageTasks.length === 0 ? <div className="crm-panel rounded-xl p-8 text-center"><Icon name="task_alt" className="text-3xl text-[var(--crm-text-muted)]" /><h2 className="mt-2 text-sm font-black">No tasks in this view</h2></div> : null}
            {!isLoading && !error ? pageTasks.map((task) => {
              const overdue = isTaskOverdue(task, now)
              const completed = task.status === 'completed'
              const busy = busyIds.has(task.id)
              return <article key={task.id} className="crm-panel flex items-start gap-3 rounded-xl p-3">
                <button type="button" disabled={busy} onClick={() => void updateTask(task.id, { status: completed ? 'pending' : 'completed' })} aria-label={completed ? `Reopen ${task.title}` : `Mark ${task.title} complete`} className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 ${completed ? 'border-[var(--crm-success)] bg-[var(--crm-success)] text-white' : overdue ? 'border-[var(--crm-danger)] text-[var(--crm-danger)]' : 'border-[var(--crm-border-strong)] text-[var(--crm-text-muted)]'}`}><Icon name={busy ? 'progress_activity' : 'check'} className={busy ? 'animate-spin' : ''} /></button>
                <button type="button" onClick={() => setSelectedTaskId(task.id)} className="min-w-0 flex-1 text-left">
                  <strong className={`block truncate text-sm ${completed ? 'text-[var(--crm-text-muted)] line-through' : 'text-[var(--crm-ink)]'}`}>{task.title}</strong>
                  <span className={`mt-1 flex items-center gap-1 text-xs font-semibold ${overdue ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-text-muted)]'}`}><Icon name="event" className="text-[15px]" />{dueLabel(task)}</span>
                  {task.contact_id ? <span className="mt-1 block truncate text-xs text-[var(--crm-info)]">{contactName(task)}</span> : null}
                </button>
                <Icon name="chevron_right" className="mt-2 shrink-0 text-[var(--crm-text-muted)]" />
              </article>
            }) : null}
          </div>}

          {data && !error ? <div className="mt-7 flex items-center text-xs text-[var(--crm-text-muted)]">
            <span>Showing {filteredTotal ? (currentPage - 1) * PAGE_SIZE + 1 : 0} to {Math.min((currentPage - 1) * PAGE_SIZE + pageTasks.length, filteredTotal)} of {filteredTotal} results</span>
            <div className="ml-auto flex items-center gap-2"><button type="button" disabled={currentPage === 1} onClick={() => { setPagination({ key: filterKey, cursors: activeCursors.slice(0, -1) }); setSelectedIds(new Set()); setSelectedTaskId(null) }} className="h-8 min-w-8 rounded border border-[var(--crm-border)] px-2 disabled:opacity-40" aria-label="Previous page">‹</button><span className="rounded border border-[var(--crm-brand)] px-3 py-2 font-bold text-[var(--crm-brand)]">{currentPage}</span><button type="button" disabled={!data?.pageInfo.hasMore || !data.pageInfo.nextCursor || currentPage >= pageCount} onClick={() => { if (!data?.pageInfo.nextCursor) return; setPagination({ key: filterKey, cursors: [...activeCursors, data.pageInfo.nextCursor] }); setSelectedIds(new Set()); setSelectedTaskId(null) }} className="h-8 min-w-8 rounded border border-[var(--crm-border)] px-2 disabled:opacity-40" aria-label="Next page">›</button></div>
          </div> : null}
        </section>
      </main>

      {selectedTask ? <TaskDetails task={selectedTask} onClose={() => setSelectedTaskId(null)} onEdit={() => { setEditingTaskId(selectedTask.id); setSelectedTaskId(null) }} onToggle={() => void updateTask(selectedTask.id, { status: selectedTask.status === 'completed' ? 'pending' : 'completed' })} onDelete={() => setDeleteRequest({ kind: 'single', ids: [selectedTask.id], label: selectedTask.title })} /> : null}
      {newTaskOpen ? <NewTaskModal department="acquisitions" showLeadSelector onClose={() => setNewTaskOpen(false)} onCreated={() => { setNewTaskOpen(false); void refreshWorklist() }} /> : null}
      {editingTask ? <EditTaskModal taskId={editingTask.id} initialTitle={editingTask.title} initialMetadata={{ task_type: editingTask.type, due_date: editingTask.due_date || undefined, assigned_to: editingTask.assigned_to || undefined, notes: editingTask.description || undefined, status: editingTask.status === 'overdue' ? 'pending' : editingTask.status, priority: 'normal', source: 'tasks' }} onClose={() => setEditingTaskId(null)} onSaved={() => { setEditingTaskId(null); void refreshWorklist() }} onDeleted={() => { setEditingTaskId(null); void refreshWorklist() }} /> : null}
      {deleteRequest ? <ConfirmDeleteDialog request={deleteRequest} saving={bulkSaving || deleteRequest.ids.some((id) => busyIds.has(id))} onCancel={() => setDeleteRequest(null)} onConfirm={() => void confirmDelete()} /> : null}
    </>
  )
}

function TaskFilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: Array<[string, string]> }) {
  return <label><span className="mb-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">{label}</span><select aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} className="crm-field h-10 w-full rounded-lg px-3 text-xs font-semibold"><option value="">Any</option>{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select></label>
}

function TaskDetails({ task, onClose, onEdit, onToggle, onDelete }: { task: Task; onClose: () => void; onEdit: () => void; onToggle: () => void; onDelete: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside role="dialog" aria-modal="true" aria-labelledby="task-detail-title" className="h-full w-full max-w-md overflow-y-auto bg-[var(--crm-surface)] p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="crm-eyebrow">Task details</p><h2 id="task-detail-title" className="mt-1 text-xl font-black">{task.title}</h2></div><button type="button" onClick={onClose} aria-label="Close task details" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="close" /></button></div><dl className="mt-6 divide-y divide-[var(--crm-border)]">{[['Status', task.status], ['Due', dueLabel(task)], ['Assigned', task.assigned_to || 'Unassigned'], ['Contact', contactName(task)], ['Property', task.property_address || 'Not linked'], ['Description', task.description || 'No description recorded']].map(([label, value]) => <div key={label} className="py-4"><dt className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--crm-text-muted)]">{label}</dt><dd className="mt-1 text-sm font-semibold">{value}</dd></div>)}</dl><div className="mt-6 grid grid-cols-2 gap-2"><button type="button" onClick={onToggle} className="crm-primary-button rounded-lg px-4 py-2.5 text-sm font-black">{task.status === 'completed' ? 'Reopen task' : 'Mark completed'}</button><button type="button" onClick={onEdit} className="crm-secondary-button rounded-lg px-4 py-2.5 text-sm font-black">Edit task</button>{task.contact_id ? <Link href={`/leads/${task.contact_id}`} prefetch={false} className="crm-secondary-button rounded-lg px-4 py-2.5 text-center text-sm font-black">Open contact</Link> : null}<button type="button" onClick={onDelete} className="rounded-lg border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-4 py-2.5 text-sm font-black text-[var(--crm-danger)]">Delete task</button></div></aside></div>
}

function ConfirmDeleteDialog({ request, saving, onCancel, onConfirm }: { request: DeleteRequest; saving: boolean; onCancel: () => void; onConfirm: () => void }) {
  return <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/55 p-4"><div role="alertdialog" aria-modal="true" aria-labelledby="delete-task-title" className="crm-panel-raised w-full max-w-md rounded-2xl p-6"><div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]"><Icon name="delete" /></div><h2 id="delete-task-title" className="mt-4 text-xl font-black">Delete {request.kind === 'bulk' ? 'selected tasks' : 'task'}?</h2><p className="mt-2 text-sm leading-6 text-[var(--crm-text-muted)]"><strong className="text-[var(--crm-ink)]">{request.label}</strong> will be permanently removed. This cannot be undone.</p><div className="mt-6 flex justify-end gap-2"><button type="button" onClick={onCancel} disabled={saving} className="crm-secondary-button h-10 rounded-lg px-4 text-sm font-bold">Cancel</button><button type="button" onClick={onConfirm} disabled={saving} className="h-10 rounded-lg border border-[var(--crm-danger)] bg-[var(--crm-danger)] px-4 text-sm font-black text-white disabled:opacity-45">{saving ? 'Deleting…' : 'Delete'}</button></div></div></div>
}

function TaskSkeleton() {
  return <div aria-label="Loading task rows" className="animate-pulse">{Array.from({ length: 6 }).map((_, index) => <div key={index} className="grid min-w-[1120px] grid-cols-[2rem_3rem_1.05fr_1.25fr_1fr_.75fr_1fr_5rem] items-center gap-3 border-b border-[var(--crm-border)] px-3 py-4"><span className="h-4 rounded bg-[var(--crm-surface-subtle)]" /><span className="h-8 w-8 rounded-full bg-[var(--crm-surface-subtle)]" />{Array.from({ length: 6 }).map((__, cell) => <span key={cell} className="h-4 rounded bg-[var(--crm-surface-subtle)]" />)}</div>)}</div>
}
