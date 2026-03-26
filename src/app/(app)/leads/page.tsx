'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { AddLeadModal } from '@/components/leads/add-lead-modal'

interface Lead {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  source: string | null
  station: string | null
  priority: string | null
  notes: string | null
  created_at: string
}

export default function LeadsPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')

  async function fetchLeads() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, state, zip, source, station, priority, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(200)
    setLeads((data as Lead[]) || [])
    setLoading(false)
  }

  useEffect(() => { fetchLeads() }, [])

  const filtered = leads.filter((l) => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      l.full_name?.toLowerCase().includes(q) ||
      l.phone?.includes(q) ||
      l.property_address?.toLowerCase().includes(q) ||
      l.city?.toLowerCase().includes(q)
    )
  })

  function handleCall(e: React.MouseEvent, phone: string | null) {
    e.stopPropagation()
    if (!phone) return
    // Dispatch custom event to open telephony bar with this number
    window.dispatchEvent(new CustomEvent('crm:dial', { detail: { phone } }))
  }

  function handleSms(e: React.MouseEvent, leadId: string) {
    e.stopPropagation()
    router.push(`/conversations?lead=${leadId}`)
  }

  function handleEmail(e: React.MouseEvent, email: string | null) {
    e.stopPropagation()
    if (!email) return
    window.location.href = `mailto:${email}`
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-32 max-w-[1440px] mx-auto">
      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); fetchLeads() }}
        />
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary mb-1">Leads</h1>
          <p className="text-slate-500 text-sm">{leads.length} total leads in database</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white font-semibold text-sm rounded-lg hover:opacity-90 transition-all active:scale-95 self-start sm:self-auto"
        >
          <Icon name="add" size="text-sm" />
          Add Lead
        </button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
          <Icon name="search" size="text-lg" />
        </span>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-xs border border-slate-200 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
          placeholder="Search leads..."
        />
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-slate-400 py-16 text-center">Loading leads...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16">
          <Icon name="people" className="text-4xl text-slate-300 mb-3" />
          <p className="text-slate-400 font-medium">No leads found</p>
          <button onClick={() => setShowAdd(true)} className="mt-4 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg">
            Add your first lead
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50">
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Name</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Phone</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden md:table-cell">Address</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden lg:table-cell">Source</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Station</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider hidden sm:table-cell">Priority</th>
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {lead.full_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                      {lead.phone || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                      {lead.property_address ? `${lead.property_address}${lead.city ? `, ${lead.city}` : ''}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden lg:table-cell">
                      {lead.source?.replace(/_/g, ' ') || '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                        {lead.station || 'intake'}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                        lead.priority === 'hot'
                          ? 'bg-red-100 text-red-600'
                          : lead.priority === 'high'
                          ? 'bg-orange-100 text-orange-600'
                          : 'bg-slate-100 text-slate-500'
                      }`}>
                        {lead.priority || 'normal'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={(e) => handleCall(e, lead.phone)}
                          disabled={!lead.phone}
                          title={lead.phone ? `Call ${lead.phone}` : 'No phone number'}
                          className="p-1.5 rounded-md hover:bg-green-50 text-slate-400 hover:text-green-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Icon name="call" size="text-base" />
                        </button>
                        <button
                          onClick={(e) => handleSms(e, lead.id)}
                          title="Open conversation"
                          className="p-1.5 rounded-md hover:bg-blue-50 text-slate-400 hover:text-blue-600 transition-colors"
                        >
                          <Icon name="sms" size="text-base" />
                        </button>
                        <button
                          onClick={(e) => handleEmail(e, lead.email)}
                          disabled={!lead.email}
                          title={lead.email ? `Email ${lead.email}` : 'No email'}
                          className="p-1.5 rounded-md hover:bg-purple-50 text-slate-400 hover:text-purple-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                        >
                          <Icon name="mail" size="text-base" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
