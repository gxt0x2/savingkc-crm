'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import { EditTaskModal } from '@/components/modals/edit-task-modal'
import { NewTaskModal } from '@/components/modals/new-task-modal'
import { useCalendarTasks } from '@/hooks/use-calendar-tasks'
import type { Task } from '@/types'

type TaskFilter = 'open' | 'overdue' | 'completed' | 'all'

export default function TasksPage() {
  const { data: tasks = [], isLoading, error, refetch } = useCalendarTasks('acquisitions')
  const [filter, setFilter] = useState<TaskFilter>('open')
  const [search, setSearch] = useState('')
  const [newTaskOpen, setNewTaskOpen] = useState(false)
  const [selectedTask, setSelectedTask] = useState<Task | null>(null)
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [now] = useState(() => Date.now())

  const filteredTasks = useMemo(() => {
    const query = search.trim().toLowerCase()
    return tasks
      .filter((task) => {
        const due = task.due_date ? new Date(task.due_date).getTime() : null
        const overdue = task.status === 'overdue' || (task.status !== 'completed' && due !== null && due < now)
        if (filter === 'open' && (task.status === 'completed' || overdue)) return false
        if (filter === 'overdue' && !overdue) return false
        if (filter === 'completed' && task.status !== 'completed') return false
        if (!query) return true
        return [task.title, task.description, task.property_address, task.assigned_to, task.contact?.first_name, task.contact?.last_name]
          .some((value) => value?.toLowerCase().includes(query))
      })
      .sort((left, right) => {
        const leftDue = left.due_date ? new Date(left.due_date).getTime() : Number.MAX_SAFE_INTEGER
        const rightDue = right.due_date ? new Date(right.due_date).getTime() : Number.MAX_SAFE_INTEGER
        return leftDue - rightDue
      })
  }, [filter, now, search, tasks])

  if (isLoading) return <div className="p-8 text-sm font-semibold text-[var(--crm-text-muted)]">Loading tasks...</div>
  if (error) return <div className="p-8"><div className="crm-panel rounded-2xl p-8 text-center"><h1 className="text-xl font-black">Tasks are temporarily unavailable</h1><button type="button" onClick={() => void refetch()} className="crm-primary-button mt-4 rounded-lg px-4 py-2 text-sm font-black">Try again</button></div></div>

  return (
    <main className="mx-auto w-full max-w-[1500px] space-y-5 px-5 py-6 pb-24">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div><p className="crm-eyebrow">Execution workspace</p><h1 className="mt-1 text-[28px] font-black tracking-[-0.035em]">Task</h1><p className="mt-1 text-sm text-[var(--crm-text-muted)]">Assigned work, due dates, and contact follow-up in one operational queue.</p></div>
        <button type="button" onClick={() => setNewTaskOpen(true)} className="crm-primary-button inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-black"><Icon name="add" />New task</button>
      </header>
      <section className="crm-panel overflow-hidden rounded-2xl">
        <div className="flex flex-col gap-3 border-b border-[var(--crm-border)] p-4 lg:flex-row lg:items-center">
          <div className="flex flex-wrap gap-1 rounded-xl bg-[var(--crm-surface-subtle)] p-1" role="tablist" aria-label="Task status">
            {(['open', 'overdue', 'completed', 'all'] as TaskFilter[]).map((value) => <button key={value} type="button" role="tab" aria-selected={filter === value} onClick={() => setFilter(value)} className={`rounded-lg px-3 py-2 text-xs font-black capitalize ${filter === value ? 'bg-[var(--crm-surface)] text-[var(--crm-brand)] shadow-sm' : 'text-[var(--crm-text-muted)]'}`}>{value}</button>)}
          </div>
          <label className="relative ml-auto w-full max-w-md"><span className="sr-only">Search tasks</span><Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 text-[19px] text-[var(--crm-text-muted)]" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search task, property, owner..." className="crm-search-field h-10 w-full rounded-lg pl-10 pr-3 text-sm outline-none" /></label>
          <Link href="/calendar?department=acquisitions" className="crm-secondary-button inline-flex h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-black"><Icon name="calendar_month" />Calendar view</Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-sm">
            <thead className="bg-[var(--crm-surface-subtle)] text-[10px] uppercase tracking-[0.09em] text-[var(--crm-text-muted)]"><tr><th className="px-5 py-3">Task</th><th className="px-4 py-3">Contact / property</th><th className="px-4 py-3">Due</th><th className="px-4 py-3">Assigned</th><th className="px-4 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead>
            <tbody className="divide-y divide-[var(--crm-border)]">{filteredTasks.map((task) => <TaskRow key={task.id} task={task} now={now} onOpen={() => setSelectedTask(task)} />)}</tbody>
          </table>
          {filteredTasks.length === 0 ? <div className="px-6 py-14 text-center"><Icon name="task_alt" className="text-4xl text-[var(--crm-text-muted)]" /><h2 className="mt-2 text-sm font-black">No tasks match this view</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Change the status filter or create a task.</p></div> : null}
        </div>
      </section>

      {selectedTask ? <TaskDetails task={selectedTask} onClose={() => setSelectedTask(null)} onEdit={() => { setEditingTask(selectedTask); setSelectedTask(null) }} /> : null}
      {newTaskOpen ? <NewTaskModal department="acquisitions" showLeadSelector onClose={() => setNewTaskOpen(false)} onCreated={() => { setNewTaskOpen(false); void refetch() }} /> : null}
      {editingTask ? <EditTaskModal taskId={editingTask.id} initialTitle={editingTask.title} initialMetadata={{ task_type: editingTask.type, due_date: editingTask.due_date || undefined, assigned_to: editingTask.assigned_to || undefined, notes: editingTask.description || undefined, status: editingTask.status === 'overdue' ? 'pending' : editingTask.status, priority: 'normal', source: 'tasks' }} onClose={() => setEditingTask(null)} onSaved={() => { setEditingTask(null); void refetch() }} onDeleted={() => { setEditingTask(null); void refetch() }} /> : null}
    </main>
  )
}

function TaskRow({ task, now, onOpen }: { task: Task; now: number; onOpen: () => void }) {
  const due = task.due_date ? new Date(task.due_date) : null
  const overdue = task.status === 'overdue' || (task.status !== 'completed' && due !== null && due.getTime() < now)
  return <tr className="hover:bg-[var(--crm-surface-subtle)]"><td className="px-5 py-4"><button type="button" onClick={onOpen} className="font-black hover:text-[var(--crm-brand)] hover:underline">{task.title}</button>{task.description ? <span className="mt-1 block max-w-md truncate text-xs text-[var(--crm-text-muted)]">{task.description}</span> : null}</td><td className="px-4 py-4"><span className="font-semibold">{task.property_address || [task.contact?.first_name, task.contact?.last_name].filter(Boolean).join(' ') || 'Not linked'}</span></td><td className={`px-4 py-4 font-semibold ${overdue ? 'text-[var(--crm-brand)]' : ''}`}>{due ? due.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'No due date'}</td><td className="px-4 py-4">{task.assigned_to || 'Unassigned'}</td><td className="px-4 py-4"><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${overdue ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]' : task.status === 'completed' ? 'bg-[#e8f8ef] text-[#07883f]' : 'bg-[#eaf2ff] text-[#1769e0]'}`}>{overdue ? 'Overdue' : task.status}</span></td><td className="px-5 py-4 text-right"><button type="button" onClick={onOpen} className="crm-secondary-button rounded-lg px-3 py-2 text-xs font-black">Open</button></td></tr>
}

function TaskDetails({ task, onClose, onEdit }: { task: Task; onClose: () => void; onEdit: () => void }) {
  return <div className="fixed inset-0 z-50 flex justify-end bg-black/45" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside role="dialog" aria-modal="true" aria-labelledby="task-detail-title" className="h-full w-full max-w-md overflow-y-auto bg-[var(--crm-surface)] p-6 shadow-2xl"><div className="flex items-start justify-between gap-3"><div><p className="crm-eyebrow">Task details</p><h2 id="task-detail-title" className="mt-1 text-xl font-black">{task.title}</h2></div><button type="button" onClick={onClose} aria-label="Close task details" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="close" /></button></div><dl className="mt-6 divide-y divide-[var(--crm-border)]">{[['Status', task.status], ['Due', task.due_date ? new Date(task.due_date).toLocaleString() : 'No due date'], ['Assigned', task.assigned_to || 'Unassigned'], ['Property', task.property_address || 'Not linked'], ['Details', task.description || 'No details recorded']].map(([label, value]) => <div key={label} className="py-4"><dt className="text-[10px] font-black uppercase tracking-[0.1em] text-[var(--crm-text-muted)]">{label}</dt><dd className="mt-1 text-sm font-semibold">{value}</dd></div>)}</dl><div className="mt-6 flex gap-2"><button type="button" onClick={onEdit} className="crm-primary-button flex-1 rounded-lg px-4 py-2.5 text-sm font-black">Edit task</button>{task.contact_id ? <Link href={`/leads/${task.contact_id}`} className="crm-secondary-button flex-1 rounded-lg px-4 py-2.5 text-center text-sm font-black">Open contact</Link> : null}</div></aside></div>
}
