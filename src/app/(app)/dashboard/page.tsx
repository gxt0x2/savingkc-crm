'use client'

import { useEffect, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { useFinancials } from '@/hooks/use-financials'

interface LeadCounts {
  total: number
  byStation: Record<string, number>
  byPriority: Record<string, number>
  daysSinceLastContract: number | null
  daysSinceLastContractSigned: number | null
}

interface MojoKpis {
  totalCalls: number
  meaningfulCalls: number
  avgMotivation: number
  hotLeads: number
  date?: string
}

interface ActivityCounts {
  calls: number
  sms_sent: number
  sms_received: number
  voicemails: number
}

interface Task {
  id: string
  title: string
  due_date: string | null
  priority: string
  status: string
  lead_id: string | null
}

interface HotLead {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string | null
  source: string | null
  created_at: string
  station: string | null
}

function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  const d = new Date(dateStr)
  const now = new Date()
  return Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24))
}

function useLeadCounts() {
  const [data, setData] = useState<LeadCounts | null>(null)
  useEffect(() => {
    const supabase = createClient()
    supabase
      .from('leads')
      .select('station, priority, created_at')
      .then(({ data: rows }) => {
        if (!rows) return
        const byStation: Record<string, number> = {}
        const byPriority: Record<string, number> = {}
        let lastContractDate: string | null = null
        for (const row of rows) {
          const s = row.station || 'unknown'
          const p = row.priority || 'normal'
          byStation[s] = (byStation[s] || 0) + 1
          byPriority[p] = (byPriority[p] || 0) + 1
          if (s === 'contract_signed') {
            if (!lastContractDate || row.created_at > lastContractDate) {
              lastContractDate = row.created_at
            }
          }
        }
        const daysSinceContract = daysSince(lastContractDate)
        setData({
          total: rows.length,
          byStation,
          byPriority,
          daysSinceLastContract: daysSinceContract,
          daysSinceLastContractSigned: daysSinceContract,
        })
      })
  }, [])
  return data
}

function useMojoKpis() {
  const [data, setData] = useState<MojoKpis | null>(null)
  useEffect(() => {
    fetch('/api/mojo-kpis')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
  }, [])
  return data
}

function useActivity() {
  const [data, setData] = useState<ActivityCounts | null>(null)
  useEffect(() => {
    fetch('/api/dashboard/activity')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {})
  }, [])
  return data
}

function useTasks() {
  const [data, setData] = useState<Task[]>([])
  useEffect(() => {
    fetch('/api/dashboard/tasks')
      .then((r) => r.json())
      .then((d) => setData(d.tasks || []))
      .catch(() => {})
  }, [])
  return data
}

function useHotLeads() {
  const [data, setData] = useState<HotLead[]>([])
  useEffect(() => {
    fetch('/api/dashboard/hot-leads')
      .then((r) => r.json())
      .then((d) => setData(d.leads || []))
      .catch(() => {})
  }, [])
  return data
}

function formatPhone(phone: string | null) {
  if (!phone) return '—'
  const digits = phone.replace(/\D/g, '')
  if (digits.length === 11 && digits[0] === '1') {
    return `(${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  return phone
}

export default function DashboardPage() {
  const leadCounts = useLeadCounts()
  const mojoKpis = useMojoKpis()
  const { data: financials } = useFinancials()
  const activity = useActivity()
  const tasks = useTasks()
  const hotLeads = useHotLeads()

  return (
    <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-[1440px] mx-auto w-full space-y-6 pb-32">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-[10px] font-bold text-secondary uppercase tracking-[0.2em] mb-1 block">
            Operations Dashboard
          </span>
          <h2 className="text-3xl font-extrabold tracking-tight text-primary">
            Today&apos;s Overview
          </h2>
        </div>
      </div>

      {/* Today's Activity */}
      <div>
        <h3 className="text-xs font-black text-secondary uppercase tracking-[0.2em] mb-3">
          Today&apos;s Activity
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="call" className="text-sm text-blue-500" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Calls</span>
            </div>
            <div className="text-3xl font-black text-primary">{activity?.calls ?? '—'}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="send" className="text-sm text-green-500" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">SMS Sent</span>
            </div>
            <div className="text-3xl font-black text-secondary">{activity?.sms_sent ?? '—'}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="inbox" className="text-sm text-purple-500" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">SMS Received</span>
            </div>
            <div className="text-3xl font-black text-primary">{activity?.sms_received ?? '—'}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="flex items-center gap-2 mb-1">
              <Icon name="voicemail" className="text-sm text-orange-500" />
              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Voicemails</span>
            </div>
            <div className="text-3xl font-black text-orange-500">{activity?.voicemails ?? '—'}</div>
          </div>
        </div>
      </div>

      {/* Mojo KPI Cards */}
      {mojoKpis !== null && (
        <div>
          <h3 className="text-xs font-black text-secondary uppercase tracking-[0.2em] mb-3">
            Mojo Dialer — {mojoKpis.date || 'Today'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Calls</div>
              <div className="text-3xl font-black text-primary">{mojoKpis.totalCalls}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Meaningful Calls</div>
              <div className="text-3xl font-black text-secondary">{mojoKpis.meaningfulCalls}</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Avg Motivation</div>
              <div className="text-3xl font-black text-primary">{mojoKpis.avgMotivation}/10</div>
            </div>
            <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Hot Leads</div>
              <div className="text-3xl font-black text-red-500">{mojoKpis.hotLeads}</div>
            </div>
          </div>
        </div>
      )}

      {/* Live Lead Pipeline */}
      <div>
        <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-3">
          Live Lead Pipeline
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Total Leads</div>
            <div className="text-3xl font-black text-primary">{leadCounts?.total ?? '—'}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Intake</div>
            <div className="text-3xl font-black text-slate-700">{leadCounts?.byStation?.intake ?? 0}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Hot Priority</div>
            <div className="text-3xl font-black text-red-500">{leadCounts?.byPriority?.hot ?? 0}</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Normal Priority</div>
            <div className="text-3xl font-black text-slate-700">{leadCounts?.byPriority?.normal ?? 0}</div>
          </div>
        </div>
      </div>

      {/* Operational Pulse */}
      <div>
        <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-3">
          Operational Pulse
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Days Since Last Closing</div>
            <div className={`text-3xl font-black ${leadCounts?.daysSinceLastContract != null ? (leadCounts.daysSinceLastContract > 30 ? 'text-red-500' : 'text-primary') : 'text-slate-300'}`}>
              {leadCounts?.daysSinceLastContract != null ? leadCounts.daysSinceLastContract : '—'}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              {leadCounts?.daysSinceLastContract != null ? 'days ago' : 'No closings yet'}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Days Since Last Contract</div>
            <div className={`text-3xl font-black ${leadCounts?.daysSinceLastContractSigned != null ? (leadCounts.daysSinceLastContractSigned > 14 ? 'text-orange-500' : 'text-secondary') : 'text-slate-300'}`}>
              {leadCounts?.daysSinceLastContractSigned != null ? leadCounts.daysSinceLastContractSigned : '—'}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              {leadCounts?.daysSinceLastContractSigned != null ? 'days ago' : 'No contracts yet'}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Revenue to Date</div>
            <div className={`text-3xl font-black ${(financials?.total.revenue || 0) > 0 ? 'text-green-500' : 'text-slate-300'}`}>
              ${((financials?.total.revenue || 0) / 1000).toFixed(financials?.total.revenue ? 1 : 0)}{(financials?.total.revenue || 0) >= 1000 ? 'k' : ''}
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              {(financials?.total.revenue || 0) > 0 ? 'Total revenue' : 'No closings recorded'}
            </div>
          </div>
          <div className="bg-white rounded-xl border border-slate-100 p-4 shadow-sm">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Expenses to Date</div>
            <div className="text-3xl font-black text-orange-500">
              ${((financials?.total.expenses || 1775) / 1000).toFixed(1)}k
            </div>
            <div className="text-[10px] text-slate-400 mt-1">
              {financials?.total.expenses ? 'Total expenses' : '$975 office/meals + $800 travel'}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Section: Tasks + Hot Leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Tasks */}
        <div>
          <h3 className="text-xs font-black text-primary uppercase tracking-[0.2em] mb-3">
            Upcoming Tasks
          </h3>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            {tasks.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">No pending tasks</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {tasks.map((task) => (
                  <div key={task.id} className="px-4 py-3 flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                      task.status === 'overdue' ? 'bg-red-500' :
                      task.priority === 'high' ? 'bg-orange-500' : 'bg-blue-400'
                    }`} />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-700 truncate">{task.title}</div>
                      <div className="text-[10px] text-slate-400">
                        {task.due_date ? new Date(task.due_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No due date'}
                        {task.status === 'overdue' && <span className="ml-1 text-red-500 font-bold">OVERDUE</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Hot Leads */}
        <div>
          <h3 className="text-xs font-black text-red-500 uppercase tracking-[0.2em] mb-3">
            Recent Hot Leads
          </h3>
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
            {hotLeads.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-400">No hot leads</div>
            ) : (
              <div className="divide-y divide-slate-50">
                {hotLeads.map((lead) => (
                  <a
                    key={lead.id}
                    href={`/leads/${lead.id}`}
                    className="px-4 py-3 flex items-center gap-3 hover:bg-slate-50 transition-colors"
                  >
                    <div className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-black flex-shrink-0">
                      {(lead.first_name?.[0] || '?').toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-slate-700 truncate">
                        {[lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown'}
                      </div>
                      <div className="text-[10px] text-slate-400 flex items-center gap-2">
                        <span>{formatPhone(lead.phone)}</span>
                        {lead.source && <span className="bg-slate-100 px-1.5 py-0.5 rounded text-[9px] font-medium">{lead.source}</span>}
                      </div>
                    </div>
                    <Icon name="chevron_right" className="text-slate-300 text-sm" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
