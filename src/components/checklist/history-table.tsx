'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Icon } from '@/components/ui/icon'

interface EodRecord {
  id: string
  type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts)
  const today = new Date()
  const isToday = d.toDateString() === today.toDateString()
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  const isYesterday = d.toDateString() === yesterday.toDateString()

  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  if (isToday) return `Today, ${time}`
  if (isYesterday) return `Yesterday, ${time}`
  return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

function extractTeamMember(record: EodRecord): string {
  if (record.metadata && typeof record.metadata === 'object') {
    const meta = record.metadata as Record<string, unknown>
    if (meta.team_member) return String(meta.team_member)
  }
  if (record.description) {
    const match = record.description.match(/^EOD by ([^:]+):/)
    if (match) return match[1].trim()
  }
  return record.agent || 'Team'
}

function extractNotes(record: EodRecord): string {
  if (record.metadata && typeof record.metadata === 'object') {
    const meta = record.metadata as Record<string, unknown>
    if (meta.went_right) return String(meta.went_right)
  }
  if (record.description) {
    const colon = record.description.indexOf(': ')
    if (colon > -1) return record.description.slice(colon + 2)
  }
  return '—'
}

export function HistoryTable({ refreshTrigger }: { refreshTrigger?: number }) {
  const [records, setRecords] = useState<EodRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchHistory() {
      setLoading(true)
      const supabase = createClient()
      const { data, error } = await supabase
        .from('lead_activities')
        .select('id, type, description, agent, metadata, created_at')
        .eq('type', 'eod_submission')
        .order('created_at', { ascending: false })
        .limit(20)

      if (error) {
        console.error('Error fetching EOD history:', error)
        setLoading(false)
        return
      }
      setRecords((data as EodRecord[]) || [])
      setLoading(false)
    }
    fetchHistory()
  }, [refreshTrigger])

  return (
    <section className="mt-16 mb-24">
      <div className="flex items-end justify-between mb-8">
        <div>
          <h2 className="text-2xl font-bold tracking-tight text-primary">Submission History</h2>
          <p className="text-on-surface-variant">EOD reflections submitted this week.</p>
        </div>
        {records.length > 0 && (
          <div className="flex items-center gap-4 text-sm font-semibold">
            <span className="flex items-center gap-2 text-secondary">
              <span className="w-2 h-2 rounded-full bg-secondary" />
              {records.length} submission{records.length !== 1 ? 's' : ''} on record
            </span>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl overflow-hidden shadow-[0_8px_24px_rgba(25,28,29,0.04)] border border-outline-variant/15">
        {loading ? (
          <div className="text-center py-12 text-on-surface-variant text-sm">Loading submission history...</div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-on-surface-variant text-sm">
            <Icon name="history" className="text-3xl mb-2 opacity-30" />
            <p>No EOD submissions yet. Submit your first End of Day report above.</p>
          </div>
        ) : (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-container-low border-b border-outline-variant/20">
                <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Protocol Type</th>
                <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Team Member</th>
                <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Status</th>
                <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Timestamp</th>
                <th className="px-6 py-4 font-bold text-primary text-xs uppercase tracking-widest">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/10">
              {records.map((row) => {
                const teamMember = extractTeamMember(row)
                const notes = extractNotes(row)
                return (
                  <tr key={row.id} className="hover:bg-surface-container-lowest transition-colors">
                    <td className="px-6 py-4">
                      <span className="px-3 py-1 rounded-full bg-tertiary-container text-on-tertiary-container text-[10px] font-bold uppercase tracking-tighter">
                        EOD Protocol
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-7 h-7 rounded-full bg-surface-container-high flex items-center justify-center text-[10px] font-bold text-on-surface-variant">
                          {teamMember.split(' ').map((n: string) => n[0]).join('').slice(0, 2)}
                        </div>
                        <span className="font-semibold text-sm">{teamMember}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-secondary font-bold text-sm">
                        <Icon name="check_circle" className="text-sm" filled />
                        Submitted
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant">{formatTimestamp(row.created_at)}</td>
                    <td className="px-6 py-4 text-sm text-on-surface-variant font-medium max-w-xs truncate">{notes}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  )
}
