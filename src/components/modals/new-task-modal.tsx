'use client'

import { useState, useRef, useEffect, useId } from 'react'
import type { AppMode } from '@/hooks/use-app-mode'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'

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
  const [title, setTitle] = useState('')
  const [taskType, setTaskType] = useState('follow_up')
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d.toISOString().slice(0, 16)
  })
  const [assignedTo, setAssignedTo] = useState('Casey')
  const [role, setRole] = useState<'setter' | 'closer' | 'admin'>(
    department === 'tc' ? 'admin' : department === 'dispositions' ? 'closer' : 'setter'
  )
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [leadId, setLeadId] = useState(initialLeadId || '')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [leadSearch, setLeadSearch] = useState(leadName || '')
  const titleRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const fieldIdPrefix = useId()
  const dialogRef = useDialogAccessibility<HTMLFormElement>(true, onClose, titleRef)

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
    if (!title.trim()) return
    setSaving(true)

    try {
      const res = await fetch('/api/calendar/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          taskType,
          dueDate,
          assignedTo,
          role,
          notes,
          leadId,
          department,
        }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        console.error('Failed to create task:', data.error)
        return
      }
      onCreated()
    } catch (err) {
      console.error('Failed to create task:', err)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="crm-modal-surface bg-surface-container-lowest w-full max-w-md overflow-hidden rounded-xl border border-outline-variant/20 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="px-6 pt-6 pb-4 border-b border-outline-variant/10">
          <h2 id={titleId} className="text-lg font-black text-primary">New Task</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label htmlFor={`${fieldIdPrefix}-title`} className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Title</label>
            <input
              id={`${fieldIdPrefix}-title`}
              ref={titleRef}
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Follow up with seller, Run comps..."
              className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>

          {showLeadSelector && !initialLeadId && (
            <div>
              <label htmlFor={`${fieldIdPrefix}-lead`} className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">
                Attach to Lead <span className="text-on-surface-variant/50">(optional)</span>
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
                className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 mb-2"
              />
              {leadSearch && (
                <div className="max-h-32 overflow-y-auto border border-outline-variant/30 rounded-lg">
                  {loadingLeads ? (
                    <p className="px-3 py-2 text-xs text-on-surface-variant">Loading...</p>
                  ) : leads.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-on-surface-variant">No leads found</p>
                  ) : (
                    leads.map((lead) => (
                      <button
                        key={lead.id}
                        type="button"
                        onClick={() => {
                          setLeadId(lead.id)
                          setLeadSearch(lead.full_name || lead.property_address || '')
                        }}
                        className="w-full text-left px-3 py-2 hover:bg-surface-container text-sm border-b border-outline-variant/10 last:border-b-0"
                      >
                        <div className="font-medium">{lead.full_name || 'Unknown'}</div>
                        {lead.property_address && (
                          <div className="text-xs text-on-surface-variant">{lead.property_address}</div>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
              {leadId && !leadSearch.includes('Search') && (
                <p className="text-xs text-primary mt-1">✓ Attached to: {leadSearch}</p>
              )}
            </div>
          )}

          {initialLeadId && leadName && (
            <div className="bg-surface-container rounded-lg px-3 py-2">
              <p className="text-xs text-on-surface-variant mb-0.5">Attached to:</p>
              <p className="text-sm font-medium text-primary">{leadName}</p>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label htmlFor={`${fieldIdPrefix}-type`} className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Type</label>
              <select id={`${fieldIdPrefix}-type`} value={taskType} onChange={(e) => setTaskType(e.target.value)} className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm">
                <option value="follow_up">Follow-up</option>
                <option value="callback">Callback</option>
                <option value="appointment">Appointment</option>
                <option value="research">Research</option>
                <option value="offer">Send Offer</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldIdPrefix}-owner`} className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Assigned To</label>
              <select id={`${fieldIdPrefix}-owner`} value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm">
                <option value="Casey">Casey</option>
                <option value="Ernest">Ernest</option>
              </select>
            </div>
            <div>
              <label htmlFor={`${fieldIdPrefix}-role`} className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Role</label>
              <select
                id={`${fieldIdPrefix}-role`}
                value={role}
                onChange={(e) => setRole(e.target.value as 'setter' | 'closer' | 'admin')}
                className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
              >
                <option value="setter">Setter</option>
                <option value="closer">Closer</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>
          <div>
            <label htmlFor={`${fieldIdPrefix}-due`} className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Due Date</label>
            <input
              id={`${fieldIdPrefix}-due`}
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor={`${fieldIdPrefix}-notes`} className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Notes <span className="text-on-surface-variant/50">(optional)</span></label>
            <textarea
              id={`${fieldIdPrefix}-notes`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional details..."
              rows={2}
              className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm resize-none"
            />
          </div>
        </div>
        <div className="px-6 py-4 bg-surface-container-high border-t border-outline-variant/10 flex justify-between">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container rounded-lg">Cancel</button>
          <button
            type="submit"
            disabled={saving || !title.trim()}
            className="px-6 py-2 text-white font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
            style={{
              background: 'var(--ck-accent)',
              boxShadow: '0 4px 16px rgba(239,68,68,0.22)',
            }}
          >
            {saving ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  )
}
