'use client'

import { useState, useRef, useEffect, useId } from 'react'
import type { AppMode } from '@/hooks/use-app-mode'
import { useAuth } from '@/hooks/use-auth'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

interface Lead {
  id: string
  full_name: string | null
  property_address: string | null
}

interface NewTaskModalProps {
  onClose: () => void
  onCreated: () => void
  leadId?: string
  leadName?: string
  showLeadSelector?: boolean
  department?: AppMode
}

export function NewTaskModal({
  onClose,
  onCreated,
  leadId: initialLeadId,
  leadName,
  showLeadSelector = false,
  department = 'acquisitions',
}: NewTaskModalProps) {
  const { user, loading: authLoading } = useAuth()
  const authenticatedActor = user ? resolveAgentTelephonyProfile(user.email).displayName : ''
  const [title, setTitle] = useState('')
  const [taskType, setTaskType] = useState('follow_up')
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d.toISOString().slice(0, 16)
  })
  // `null` means "follow the authenticated actor". An empty string is an
  // intentional Unassigned choice and must not fall back to the viewed agent.
  const [assignedTo, setAssignedTo] = useState<string | null>(null)
  const [role, setRole] = useState<'setter' | 'closer' | 'admin'>(
    department === 'tc' ? 'admin' : department === 'dispositions' ? 'closer' : 'setter'
  )
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [leadId, setLeadId] = useState(initialLeadId || '')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [leadSearch, setLeadSearch] = useState(leadName || '')
  const titleRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const fieldIdPrefix = useId()
  const dialogRef = useDialogAccessibility<HTMLFormElement>(true, onClose, titleRef)
  const selectedAssignee = assignedTo ?? authenticatedActor
  const assigneeOptions = Array.from(new Set([authenticatedActor, 'Casey', 'Ernest', 'Gertha'].filter(Boolean)))

  // Load leads when showing the selector
  useEffect(() => {
    if (showLeadSelector && !initialLeadId) {
      loadLeads()
    }
  }, [showLeadSelector, initialLeadId])

  async function loadLeads(search = '') {
    setLoadingLeads(true)
    try {
      const query = search.trim()
      const url = query.length >= 2
        ? `/api/leads/search?q=${encodeURIComponent(query)}&limit=20`
        : '/api/leads?limit=50'
      const res = await fetch(url, { cache: 'no-store' })
      const data = await res.json()
      const rows = query.length >= 2 ? data.results : data.leads
      setLeads((rows || []).map((row: Lead) => ({
        id: row.id,
        full_name: row.full_name,
        property_address: row.property_address,
      })))
    } catch (err) {
      console.error('Failed to load leads:', err)
      setLeads([])
    } finally {
      setLoadingLeads(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || authLoading || !selectedAssignee) return
    setSaving(true)
    setSaveError('')

    try {
      const res = await fetch('/api/calendar/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          taskType,
          dueDate,
          assignedTo: selectedAssignee,
          role,
          notes,
          leadId,
          department,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        setSaveError(data.error || 'Task could not be created. Your entries are still here.')
        return
      }
      onCreated()
    } catch (err) {
      console.error('Failed to create task:', err)
      setSaveError('Task could not be created. Check your connection and try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="crm-panel-raised flex max-h-[calc(100dvh-env(safe-area-inset-top)-.75rem)] w-full max-w-md flex-col overflow-hidden rounded-t-3xl sm:max-h-[min(90dvh,46rem)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="flex items-start border-b border-[var(--crm-border)] px-4 pb-3 pt-3 sm:px-6 sm:pb-4 sm:pt-6">
          <div className="min-w-0 flex-1"><div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-[var(--crm-border-strong)] sm:hidden" /><p className="crm-eyebrow">Task workspace</p>
          <h2 id={titleId} className="mt-0.5 text-xl font-black text-[var(--crm-ink)]">Add task</h2></div>
          <button type="button" onClick={onClose} className="crm-icon-button mt-4 grid h-11 w-11 place-items-center rounded-xl sm:mt-0" aria-label="Close task form">×</button>
        </div>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
          <div>
            <label htmlFor={`${fieldIdPrefix}-title`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Title</label>
            <input
              id={`${fieldIdPrefix}-title`}
              ref={titleRef}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow up with seller, Run comps..."
              className="crm-field min-h-11 w-full rounded-lg px-3 py-2 text-base outline-none"
            />
          </div>

          {showLeadSelector && !initialLeadId && (
            <div>
              <label htmlFor={`${fieldIdPrefix}-lead`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">
                Attach to Lead <span className="font-medium text-[var(--crm-text-dim)]">(optional)</span>
              </label>
              <input
                id={`${fieldIdPrefix}-lead`}
                type="text"
                value={leadSearch}
                onChange={(e) => {
                  setLeadSearch(e.target.value)
                  loadLeads(e.target.value)
                }}
                placeholder="Search leads by name or address..."
                className="crm-field mb-2 w-full rounded-lg px-3 py-2 text-sm outline-none"
              />
              {leadSearch && (
                <div className="max-h-32 overflow-y-auto rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)]">
                  {loadingLeads ? (
                    <p className="px-3 py-2 text-xs text-[var(--crm-text-muted)]">Loading...</p>
                  ) : leads.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-[var(--crm-text-muted)]">No leads found</p>
                  ) : (
                    leads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => {
                          setLeadId(lead.id)
                          setLeadSearch(lead.full_name || lead.property_address || '')
                        }}
                        className="w-full border-b border-[var(--crm-border)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--crm-surface-subtle)]"
                      >
                        <div className="font-medium">{lead.full_name || 'Unknown'}</div>
                        {lead.property_address && (
                          <div className="text-xs text-[var(--crm-text-muted)]">{lead.property_address}</div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
              {leadId && !leadSearch.includes('Search') && (
                <p className="mt-1 text-xs font-semibold text-[var(--crm-success)]">✓ Attached to: {leadSearch}</p>
              )}
            </div>
          )}

          {initialLeadId && leadName && (
            <div className="rounded-lg bg-[var(--crm-info-soft)] px-3 py-2">
              <p className="mb-0.5 text-xs text-[var(--crm-text-muted)]">Attached to:</p>
              <p className="text-sm font-medium text-[var(--crm-info)]">{leadName}</p>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label htmlFor={`${fieldIdPrefix}-type`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Type</label>
              <select id={`${fieldIdPrefix}-type`} value={taskType} onChange={(e) => setTaskType(e.target.value)} className="crm-field min-h-11 w-full rounded-lg px-3 py-2 text-base sm:text-sm">
                <option value="follow_up">Follow-up</option>
                <option value="callback">Callback</option>
                <option value="appointment">Appointment</option>
                <option value="research">Research</option>
                <option value="offer">Send Offer</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldIdPrefix}-owner`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Assigned To</label>
              <select id={`${fieldIdPrefix}-owner`} value={selectedAssignee} onChange={(e) => setAssignedTo(e.target.value)} disabled={authLoading} className="crm-field min-h-11 w-full rounded-lg px-3 py-2 text-base disabled:opacity-60 sm:text-sm">
                {authLoading ? <option value="">Loading your profile…</option> : null}
                {assigneeOptions.map((name) => <option key={name} value={name}>{name}{name === authenticatedActor ? ' (me)' : ''}</option>)}
                <option value="">Unassigned</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldIdPrefix}-role`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Role</label>
              <select
                id={`${fieldIdPrefix}-role`}
                value={role}
                onChange={(e) => setRole(e.target.value as 'setter' | 'closer' | 'admin')}
                className="crm-field min-h-11 w-full rounded-lg px-3 py-2 text-base sm:text-sm"
              >
                <option value="setter">Setter</option>
                <option value="closer">Closer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor={`${fieldIdPrefix}-due`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Due Date</label>
            <input
              id={`${fieldIdPrefix}-due`}
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="crm-field min-h-11 w-full rounded-lg px-3 py-2 text-base sm:text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${fieldIdPrefix}-notes`} className="mb-1 block text-xs font-bold uppercase tracking-wider text-[var(--crm-text-muted)]">Notes <span className="font-medium text-[var(--crm-text-dim)]">(optional)</span></label>
            <textarea
              id={`${fieldIdPrefix}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={2}
              className="crm-field w-full resize-none rounded-lg px-3 py-2 text-base"
            />
          </div>
          {saveError ? <p role="alert" className="rounded-xl border border-[var(--crm-danger-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-sm font-semibold text-[var(--crm-danger)]">{saveError}</p> : null}
        </div>
        <div className="flex justify-between gap-3 border-t border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 sm:px-6 sm:py-4">
          <button type="button" onClick={onClose} className="crm-secondary-button min-h-11 flex-1 rounded-xl px-4 py-2 text-sm font-bold sm:flex-none">Cancel</button>
          <button
            type="submit"
            disabled={saving || authLoading || !selectedAssignee || !title.trim()}
            className="crm-primary-button min-h-11 flex-[1.35] rounded-xl px-6 py-2 text-sm font-bold disabled:opacity-40 sm:flex-none"
          >
            {saving ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  )
}
