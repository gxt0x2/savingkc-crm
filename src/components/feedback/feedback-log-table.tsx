'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface FeedbackItem {
  id: string
  type: 'bug' | 'feature' | 'feedback' | 'error'
  section: string
  description: string
  priority: string
  status: string
  created_at: string
  agent_name: string
  page_url?: string
  source: 'feedback' | 'error_log'
  error_type?: string
}

export function FeedbackLogTable() {
  const [items, setItems] = useState<FeedbackItem[]>([])
  const [loading, setLoading] = useState(true)
  const [filterType, setFilterType] = useState<string>('')
  const [filterStatus, setFilterStatus] = useState<string>('')
  const [selectedItem, setSelectedItem] = useState<FeedbackItem | null>(null)

  useEffect(() => {
    fetchItems()
  }, [filterType, filterStatus])

  async function fetchItems() {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterType) params.append('type', filterType)
      if (filterStatus) params.append('status', filterStatus)

      const res = await fetch(`/api/feedback/log?${params}`)
      if (res.ok) {
        const data = await res.json()
        setItems(data.items || [])
      }
    } catch (err) {
      console.error('Failed to fetch feedback log:', err)
    } finally {
      setLoading(false)
    }
  }

  async function updateStatus(id: string, source: string, newStatus: string) {
    try {
      const res = await fetch('/api/feedback/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, source, status: newStatus }),
      })

      if (res.ok) {
        fetchItems()
        setSelectedItem(null)
      }
    } catch (err) {
      console.error('Failed to update status:', err)
    }
  }

  const priorityColors: Record<string, string> = {
    low: 'text-slate-600 bg-slate-100',
    medium: 'text-blue-600 bg-blue-100',
    high: 'text-amber-600 bg-amber-100',
    critical: 'text-red-600 bg-red-100',
  }

  const typeIcons: Record<string, string> = {
    bug: 'bug_report',
    feature: 'lightbulb',
    feedback: 'chat',
    error: 'error',
  }

  if (loading) {
    return (
      <div className="animate-pulse space-y-4">
        <div className="h-12 bg-slate-200 rounded" />
        <div className="h-24 bg-slate-200 rounded" />
        <div className="h-24 bg-slate-200 rounded" />
      </div>
    )
  }

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="px-4 py-2 border border-outline-variant/20 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
        >
          <option value="">All Types</option>
          <option value="bug">Bug Reports</option>
          <option value="feature">Feature Requests</option>
          <option value="feedback">Feedback</option>
          <option value="error">System Errors</option>
        </select>

        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="px-4 py-2 border border-outline-variant/20 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 bg-white"
        >
          <option value="">All Status</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="in_progress">In Progress</option>
          <option value="testing">Testing</option>
          <option value="resolved">Resolved</option>
        </select>
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl overflow-hidden">
        <table className="w-full">
          <thead className="bg-surface-container">
            <tr className="text-xs font-bold text-on-surface-variant uppercase tracking-wider">
              <th className="px-4 py-3 text-left">Type</th>
              <th className="px-4 py-3 text-left">Section</th>
              <th className="px-4 py-3 text-left">Description</th>
              <th className="px-4 py-3 text-left">Priority</th>
              <th className="px-4 py-3 text-left">Status</th>
              <th className="px-4 py-3 text-left">Date</th>
              <th className="px-4 py-3 text-left">By</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-on-surface-variant">
                  No items found
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={`${item.source}-${item.id}`}
                  onClick={() => setSelectedItem(item)}
                  className="border-t border-outline-variant/10 hover:bg-surface-container/50 cursor-pointer transition-colors"
                >
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Icon name={typeIcons[item.type]} size="text-base" className="text-on-surface-variant" />
                      <span className="text-xs font-semibold capitalize">{item.type}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold">{item.section}</td>
                  <td className="px-4 py-3 text-xs max-w-md truncate">{item.description}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${priorityColors[item.priority]}`}>
                      {item.priority.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs font-semibold capitalize">{item.status.replace('_', ' ')}</td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">
                    {new Date(item.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </td>
                  <td className="px-4 py-3 text-xs text-on-surface-variant">{item.agent_name}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Detail Modal */}
      {selectedItem && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setSelectedItem(null)}>
          <div className="bg-white rounded-2xl p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Icon name={typeIcons[selectedItem.type]} size="text-xl" className="text-primary" />
                  <h3 className="text-xl font-black text-primary capitalize">{selectedItem.type}</h3>
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${priorityColors[selectedItem.priority]}`}>
                    {selectedItem.priority.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs text-on-surface-variant">
                  {selectedItem.section} • {new Date(selectedItem.created_at).toLocaleString()} • {selectedItem.agent_name}
                </div>
              </div>
              <button
                onClick={() => setSelectedItem(null)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center transition-colors"
              >
                <Icon name="close" size="text-lg" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Description</div>
                <div className="text-sm whitespace-pre-wrap">{selectedItem.description}</div>
              </div>

              {selectedItem.page_url && (
                <div>
                  <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-1">Page URL</div>
                  <div className="text-xs font-mono bg-surface-container p-2 rounded">{selectedItem.page_url}</div>
                </div>
              )}

              <div>
                <div className="text-xs font-bold text-on-surface-variant uppercase tracking-wider mb-2">Update Status</div>
                <div className="flex gap-2">
                  {['open', 'acknowledged', 'in_progress', 'testing', 'resolved'].map((status) => (
                    <button
                      key={status}
                      onClick={() => updateStatus(selectedItem.id, selectedItem.source, status)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors capitalize ${
                        selectedItem.status === status
                          ? 'bg-primary text-white'
                          : 'bg-surface-container hover:bg-surface-container-high'
                      }`}
                    >
                      {status.replace('_', ' ')}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
