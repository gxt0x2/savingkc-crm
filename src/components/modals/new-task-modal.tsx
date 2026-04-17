'use client'

import { useState, useRef, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

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
}

export function NewTaskModal({
  onClose,
  onCreated,
  leadId: initialLeadId,
  leadName,
  showLeadSelector = false
}: NewTaskModalProps) {
  const [title, setTitle] = useState('')
  const [taskType, setTaskType] = useState('follow_up')
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date()
    d.setHours(d.getHours() + 1, 0, 0, 0)
    return d.toISOString().slice(0, 16)
  })
  const [assignedTo, setAssignedTo] = useState('Casey')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [leadId, setLeadId] = useState(initialLeadId || '')
  const [leads, setLeads] = useState<Lead[]>([])
  const [loadingLeads, setLoadingLeads] = useState(false)
  const [leadSearch, setLeadSearch] = useState(leadName || '')
  const titleRef = useRef<HTMLInputElement>(null)

  // Load leads when showing the selector
  useEffect(() => {
    if (showLeadSelector && !initialLeadId) {
      loadLeads()
    }
  }, [showLeadSelector, initialLeadId])

  async function loadLeads(search = '') {
    setLoadingLeads(true)
    const supabase = createClient()

    let query = supabase
      .from('leads')
      .select('id, full_name, property_address')
      .order('created_at', { ascending: false })
      .limit(50)

    if (search) {
      query = query.or(`full_name.ilike.%${search}%,property_address.ilike.%${search}%`)
    }

    const { data } = await query
    setLeads(data || [])
    setLoadingLeads(false)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim()) return
    setSaving(true)

    const supabase = createClient()
    const { error } = await supabase.from('lead_activities').insert({
      lead_id: leadId || null,
      activity_type: 'task',
      description: title.trim(),
      agent: assignedTo,
      metadata: {
        task_type: taskType,
        due_date: new Date(dueDate).toISOString(),
        assigned_to: assignedTo,
        priority: 'normal',
        status: 'pending',
        notes: notes.trim() || undefined,
        source: leadId ? 'lead_detail_task' : 'calendar_new_task',
      },
    })

    setSaving(false)
    if (!error) onCreated()
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        className="bg-surface-container-lowest rounded-xl shadow-2xl w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleSubmit}
      >
        <div className="px-6 pt-6 pb-4 border-b border-outline-variant/10">
          <h2 className="text-lg font-black text-primary">New Task</h2>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Title</label>
            <input
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
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">
                Attach to Lead <span className="text-on-surface-variant/50">(optional)</span>
              </label>
              <input
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

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Type</label>
              <select value={taskType} onChange={(e) => setTaskType(e.target.value)} className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm">
                <option value="follow_up">Follow-up</option>
                <option value="callback">Callback</option>
                <option value="appointment">Appointment</option>
                <option value="research">Research</option>
                <option value="offer">Send Offer</option>
                <option value="general">General</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Assigned To</label>
              <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)} className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm">
                <option value="Casey">Casey</option>
                <option value="Ernest">Ernest</option>
              </select>
            </div>
          </div>
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Due Date</label>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1 block">Notes <span className="text-on-surface-variant/50">(optional)</span></label>
            <textarea
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
          <button type="submit" disabled={saving || !title.trim()} className="px-6 py-2 bg-primary text-on-primary font-bold rounded-lg text-sm hover:opacity-90 disabled:opacity-40">
            {saving ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </form>
    </div>
  )
}
