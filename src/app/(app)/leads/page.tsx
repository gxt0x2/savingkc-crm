'use client'

import { useEffect, useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { AddLeadModal } from '@/components/leads/add-lead-modal'
import { calculateTemperature, TEMPERATURE_CONFIG } from '@/lib/lead-temperature'
import { toProperCase, formatPhone } from '@/lib/format'

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
  last_activity_at?: string | null
}

type SortKey = 'full_name' | 'phone' | 'property_address' | 'source' | 'station' | 'priority' | 'created_at' | 'temperature'
type SortDir = 'asc' | 'desc'

export default function LeadsPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('created_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Filters
  const [filterStage, setFilterStage] = useState<string[]>([])
  const [filterTemp, setFilterTemp] = useState<string[]>([])
  const [filterSource, setFilterSource] = useState<string[]>([])

  async function fetchLeads() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, state, zip, source, station, priority, notes, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    setLeads((data as Lead[]) || [])
    setLoading(false)
  }

  useEffect(() => { fetchLeads() }, [])

  // Available filter options
  const stageOptions = useMemo(() => [...new Set(leads.map(l => l.station || 'intake'))].sort(), [leads])
  const sourceOptions = useMemo(() => [...new Set(leads.map(l => l.source).filter(Boolean))].sort() as string[], [leads])

  // Filter + sort
  const processed = useMemo(() => {
    let result = leads.filter((l) => {
      // Search
      if (search) {
        const q = search.toLowerCase()
        const match = l.full_name?.toLowerCase().includes(q) ||
          l.phone?.includes(q) ||
          l.property_address?.toLowerCase().includes(q) ||
          l.city?.toLowerCase().includes(q)
        if (!match) return false
      }
      // Stage filter
      if (filterStage.length > 0 && !filterStage.includes(l.station || 'intake')) return false
      // Temperature filter
      if (filterTemp.length > 0) {
        const temp = calculateTemperature(l)
        if (!filterTemp.includes(temp)) return false
      }
      // Source filter
      if (filterSource.length > 0 && !filterSource.includes(l.source || '')) return false
      return true
    })

    // Sort
    result.sort((a, b) => {
      let aVal: string | number = ''
      let bVal: string | number = ''

      switch (sortKey) {
        case 'full_name':
          aVal = (a.full_name || '').toLowerCase()
          bVal = (b.full_name || '').toLowerCase()
          break
        case 'phone':
          aVal = a.phone || ''
          bVal = b.phone || ''
          break
        case 'property_address':
          aVal = (a.property_address || '').toLowerCase()
          bVal = (b.property_address || '').toLowerCase()
          break
        case 'source':
          aVal = (a.source || '').toLowerCase()
          bVal = (b.source || '').toLowerCase()
          break
        case 'station':
          aVal = a.station || 'intake'
          bVal = b.station || 'intake'
          break
        case 'priority':
          aVal = a.priority || 'normal'
          bVal = b.priority || 'normal'
          break
        case 'created_at':
          aVal = new Date(a.created_at).getTime()
          bVal = new Date(b.created_at).getTime()
          break
        case 'temperature':
          const temps = { hot: 4, warm: 3, cool: 2, cold: 1 }
          aVal = temps[calculateTemperature(a)] || 0
          bVal = temps[calculateTemperature(b)] || 0
          break
      }

      if (aVal < bVal) return sortDir === 'asc' ? -1 : 1
      if (aVal > bVal) return sortDir === 'asc' ? 1 : -1
      return 0
    })

    return result
  }, [leads, search, sortKey, sortDir, filterStage, filterTemp, filterSource])

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  function SortHeader({ label, sortKeyVal, className }: { label: string; sortKeyVal: SortKey; className?: string }) {
    const isActive = sortKey === sortKeyVal
    return (
      <th
        className={`text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-primary transition-colors ${className || ''}`}
        onClick={() => handleSort(sortKeyVal)}
      >
        <span className="flex items-center gap-1">
          {label}
          {isActive && (
            <Icon name={sortDir === 'asc' ? 'arrow_upward' : 'arrow_downward'} size="text-xs" className="text-primary" />
          )}
        </span>
      </th>
    )
  }

  function handleCall(e: React.MouseEvent, phone: string | null) {
    e.stopPropagation()
    if (!phone) return
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

  const hasActiveFilters = filterStage.length > 0 || filterTemp.length > 0 || filterSource.length > 0

  function toggleFilter(arr: string[], setArr: (v: string[]) => void, val: string) {
    setArr(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val])
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
          <p className="text-slate-500 text-sm">{processed.length} of {leads.length} leads shown</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white font-semibold text-sm rounded-lg hover:opacity-90 transition-all active:scale-95 self-start sm:self-auto"
        >
          <Icon name="add" size="text-sm" />
          Add Lead
        </button>
      </div>

      {/* Search + Filters */}
      <div className="mb-4 space-y-3">
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 max-w-xs">
            <span className="absolute inset-y-0 left-3 flex items-center text-slate-400">
              <Icon name="search" size="text-lg" />
            </span>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full border border-slate-200 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              placeholder="Search leads..."
            />
          </div>

          {/* Filter Dropdowns */}
          <div className="flex gap-2 flex-wrap">
            {/* Stage Filter */}
            <div className="relative group">
              <button className={`flex items-center gap-1 px-3 py-2 border rounded-lg text-sm font-medium transition-all ${
                filterStage.length > 0 ? 'bg-primary/10 border-primary text-primary' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
                <Icon name="filter_list" size="text-sm" />
                Stage {filterStage.length > 0 && `(${filterStage.length})`}
              </button>
              <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 hidden group-hover:block min-w-[160px]">
                {stageOptions.map(s => (
                  <button
                    key={s}
                    onClick={() => toggleFilter(filterStage, setFilterStage, s)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${
                      filterStage.includes(s) ? 'text-primary font-bold' : 'text-slate-600'
                    }`}
                  >
                    {filterStage.includes(s) && <Icon name="check" size="text-sm" />}
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            </div>

            {/* Temperature Filter */}
            <div className="relative group">
              <button className={`flex items-center gap-1 px-3 py-2 border rounded-lg text-sm font-medium transition-all ${
                filterTemp.length > 0 ? 'bg-primary/10 border-primary text-primary' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
                <Icon name="thermostat" size="text-sm" />
                Temp {filterTemp.length > 0 && `(${filterTemp.length})`}
              </button>
              <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 hidden group-hover:block min-w-[120px]">
                {(['hot', 'warm', 'cool', 'cold'] as const).map(t => {
                  const cfg = TEMPERATURE_CONFIG[t]
                  return (
                    <button
                      key={t}
                      onClick={() => toggleFilter(filterTemp, setFilterTemp, t)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${
                        filterTemp.includes(t) ? 'font-bold' : ''
                      }`}
                    >
                      <span className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                      {cfg.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Source Filter */}
            {sourceOptions.length > 0 && (
              <div className="relative group">
                <button className={`flex items-center gap-1 px-3 py-2 border rounded-lg text-sm font-medium transition-all ${
                  filterSource.length > 0 ? 'bg-primary/10 border-primary text-primary' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}>
                  <Icon name="source" size="text-sm" />
                  Source {filterSource.length > 0 && `(${filterSource.length})`}
                </button>
                <div className="absolute top-full left-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 hidden group-hover:block min-w-[160px] max-h-[200px] overflow-y-auto">
                  {sourceOptions.map(s => (
                    <button
                      key={s}
                      onClick={() => toggleFilter(filterSource, setFilterSource, s)}
                      className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${
                        filterSource.includes(s) ? 'text-primary font-bold' : 'text-slate-600'
                      }`}
                    >
                      {filterSource.includes(s) && <Icon name="check" size="text-sm" />}
                      {s.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Active Filter Chips */}
        {hasActiveFilters && (
          <div className="flex gap-2 flex-wrap items-center">
            {filterStage.map(s => (
              <span key={`stage-${s}`} className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs font-bold rounded-full">
                {s.replace(/_/g, ' ')}
                <button onClick={() => setFilterStage(prev => prev.filter(v => v !== s))} className="hover:text-red-500">
                  <Icon name="close" size="text-xs" />
                </button>
              </span>
            ))}
            {filterTemp.map(t => (
              <span key={`temp-${t}`} className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs font-bold rounded-full">
                {t}
                <button onClick={() => setFilterTemp(prev => prev.filter(v => v !== t))} className="hover:text-red-500">
                  <Icon name="close" size="text-xs" />
                </button>
              </span>
            ))}
            {filterSource.map(s => (
              <span key={`src-${s}`} className="flex items-center gap-1 px-2 py-1 bg-primary/10 text-primary text-xs font-bold rounded-full">
                {s.replace(/_/g, ' ')}
                <button onClick={() => setFilterSource(prev => prev.filter(v => v !== s))} className="hover:text-red-500">
                  <Icon name="close" size="text-xs" />
                </button>
              </span>
            ))}
            <button
              onClick={() => { setFilterStage([]); setFilterTemp([]); setFilterSource([]) }}
              className="text-xs font-bold text-red-500 hover:underline"
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      {loading ? (
        <div className="text-slate-400 py-16 text-center">Loading leads...</div>
      ) : processed.length === 0 ? (
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
                  <SortHeader label="Name" sortKeyVal="full_name" />
                  <SortHeader label="Temp" sortKeyVal="temperature" className="hidden sm:table-cell" />
                  <SortHeader label="Phone" sortKeyVal="phone" className="hidden sm:table-cell" />
                  <SortHeader label="Address" sortKeyVal="property_address" className="hidden md:table-cell" />
                  <SortHeader label="Source" sortKeyVal="source" className="hidden lg:table-cell" />
                  <SortHeader label="Station" sortKeyVal="station" />
                  <SortHeader label="Priority" sortKeyVal="priority" className="hidden sm:table-cell" />
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {processed.map((lead) => (
                  <tr
                    key={lead.id}
                    className="border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer"
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">
                      {toProperCase(lead.full_name) || '--'}
                    </td>
                    <td className="px-4 py-3 hidden sm:table-cell">
                      {(() => {
                        const temp = calculateTemperature(lead)
                        const cfg = TEMPERATURE_CONFIG[temp]
                        return (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${cfg.bg} ${cfg.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                            {cfg.label}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                      {formatPhone(lead.phone) || '--'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden md:table-cell">
                      {lead.property_address ? `${lead.property_address}${lead.city ? `, ${lead.city}` : ''}` : '--'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden lg:table-cell">
                      {lead.source?.replace(/_/g, ' ') || '--'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600">
                        {(lead.station || 'intake').replace(/_/g, ' ')}
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
                          title={lead.phone ? `Call ${formatPhone(lead.phone)}` : 'No phone number'}
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
