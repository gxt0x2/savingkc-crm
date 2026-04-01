'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
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
  updated_at?: string | null
}

type SortKey = 'full_name' | 'phone' | 'property_address' | 'source' | 'station' | 'priority' | 'created_at' | 'updated_at' | 'temperature'
type SortDir = 'asc' | 'desc'

const STATION_OPTIONS = ['new', 'contacted', 'qualified', 'offer_made', 'under_contract', 'disposition', 'closed', 'dead'] as const
const PRIORITY_OPTIONS = ['hot', 'high', 'normal'] as const

export default function LeadsPage() {
  const router = useRouter()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('updated_at')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Filters
  const [filterStage, setFilterStage] = useState<string[]>([])
  const [filterTemp, setFilterTemp] = useState<string[]>([])
  const [filterSource, setFilterSource] = useState<string[]>([])

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [stationDropdownOpen, setStationDropdownOpen] = useState(false)
  const [priorityDropdownOpen, setPriorityDropdownOpen] = useState(false)
  const [actionFeedback, setActionFeedback] = useState<string | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const stationRef = useRef<HTMLDivElement>(null)
  const priorityRef = useRef<HTMLDivElement>(null)
  const headerCheckboxRef = useRef<HTMLInputElement>(null)

  async function fetchLeads() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, state, zip, source, station, priority, notes, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500)
    setLeads((data as Lead[]) || [])
    setLoading(false)
  }

  useEffect(() => { fetchLeads() }, [])

  // Clear selection when filters change
  useEffect(() => {
    setSelectedIds(new Set())
  }, [search, filterStage, filterTemp, filterSource])

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (stationRef.current && !stationRef.current.contains(e.target as Node)) setStationDropdownOpen(false)
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) setPriorityDropdownOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

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
        case 'updated_at':
          aVal = a.updated_at ? new Date(a.updated_at).getTime() : 0
          bVal = b.updated_at ? new Date(b.updated_at).getTime() : 0
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

  // Bulk selection helpers
  const pageIds = processed.map(l => l.id)
  const allSelected = pageIds.length > 0 && pageIds.every(id => selectedIds.has(id))
  const someSelected = pageIds.some(id => selectedIds.has(id))

  useEffect(() => {
    if (headerCheckboxRef.current) {
      headerCheckboxRef.current.indeterminate = someSelected && !allSelected
    }
  }, [someSelected, allSelected])

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev)
        pageIds.forEach(id => next.delete(id))
        return next
      })
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev)
        pageIds.forEach(id => next.add(id))
        return next
      })
    }
  }

  function showFeedback(msg: string) {
    setActionFeedback(msg)
    setTimeout(() => setActionFeedback(null), 2500)
  }

  async function handleBulkStation(station: string) {
    setStationDropdownOpen(false)
    setBulkLoading(true)
    try {
      const supabase = createClient()
      const ids = Array.from(selectedIds)
      const { error } = await supabase
        .from('leads')
        .update({ station })
        .in('id', ids)
      if (error) throw error
      showFeedback(`Moved ${ids.length} lead${ids.length !== 1 ? 's' : ''} to "${station.replace(/_/g, ' ')}"`)
      setSelectedIds(new Set())
      fetchLeads()
    } catch {
      showFeedback('Failed to update leads')
    } finally {
      setBulkLoading(false)
    }
  }

  async function handleBulkPriority(priority: string) {
    setPriorityDropdownOpen(false)
    setBulkLoading(true)
    try {
      const supabase = createClient()
      const ids = Array.from(selectedIds)
      const { error } = await supabase
        .from('leads')
        .update({ priority })
        .in('id', ids)
      if (error) throw error
      showFeedback(`Set ${ids.length} lead${ids.length !== 1 ? 's' : ''} to "${priority}" priority`)
      setSelectedIds(new Set())
      fetchLeads()
    } catch {
      showFeedback('Failed to update leads')
    } finally {
      setBulkLoading(false)
    }
  }

  async function handleBulkDelete() {
    const count = selectedIds.size
    if (!window.confirm(`Delete ${count} lead${count !== 1 ? 's' : ''}? This cannot be undone.`)) return
    setBulkLoading(true)
    try {
      const ids = Array.from(selectedIds)
      const res = await fetch('/api/leads', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || 'Delete failed')
      showFeedback(`Deleted ${ids.length} lead${ids.length !== 1 ? 's' : ''}`)
      setSelectedIds(new Set())
      fetchLeads()
    } catch {
      showFeedback('Failed to delete leads')
    } finally {
      setBulkLoading(false)
    }
  }

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

  const AVATAR_COLORS = [
    'bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500',
    'bg-rose-500', 'bg-cyan-500', 'bg-indigo-500', 'bg-teal-500',
    'bg-pink-500', 'bg-orange-500',
  ]

  function getInitials(name: string | null): string {
    if (!name) return '?'
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
    return (parts[0][0] || '?').toUpperCase()
  }

  function getAvatarColor(name: string | null): string {
    if (!name) return AVATAR_COLORS[0]
    let hash = 0
    for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
    return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length]
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
                  <th className="w-10 px-3 py-3">
                    <input
                      ref={headerCheckboxRef}
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-300 cursor-pointer"
                    />
                  </th>
                  <SortHeader label="Name" sortKeyVal="full_name" />
                  <SortHeader label="Temp" sortKeyVal="temperature" className="hidden sm:table-cell" />
                  <SortHeader label="Phone" sortKeyVal="phone" className="hidden sm:table-cell" />
                  <SortHeader label="Address" sortKeyVal="property_address" className="hidden md:table-cell" />
                  <SortHeader label="Source" sortKeyVal="source" className="hidden lg:table-cell" />
                  <SortHeader label="Station" sortKeyVal="station" />
                  <SortHeader label="Priority" sortKeyVal="priority" className="hidden sm:table-cell" />
                  <SortHeader label="Activity" sortKeyVal="updated_at" className="hidden lg:table-cell" />
                  <th className="text-left px-4 py-3 text-xs font-bold text-slate-500 uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {processed.map((lead) => (
                  <tr
                    key={lead.id}
                    className={`border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer ${selectedIds.has(lead.id) ? 'bg-primary/5' : ''}`}
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    <td className="px-3 py-3" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedIds.has(lead.id)}
                        onChange={() => toggleSelect(lead.id)}
                        className="rounded border-slate-300 cursor-pointer"
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${getAvatarColor(lead.full_name)}`}>
                          {getInitials(lead.full_name)}
                        </span>
                        <span className="font-medium text-slate-900">{toProperCase(lead.full_name) || '--'}</span>
                      </div>
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
                    <td className="px-4 py-3 text-slate-400 text-xs hidden lg:table-cell whitespace-nowrap">
                      {lead.updated_at
                        ? new Date(lead.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                        : '--'}
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

      {/* Floating Bulk Action Bar */}
      {selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white rounded-xl shadow-2xl px-5 py-3 flex items-center gap-4">
          <span className="text-sm font-semibold whitespace-nowrap">{selectedIds.size} selected</span>

          <div className="h-5 w-px bg-slate-600" />

          {/* Change Station dropdown */}
          <div className="relative" ref={stationRef}>
            <button
              onClick={() => { setStationDropdownOpen(!stationDropdownOpen); setPriorityDropdownOpen(false) }}
              disabled={bulkLoading}
              className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition whitespace-nowrap disabled:opacity-50"
            >
              <Icon name="swap_horiz" size="text-sm" className="mr-1 align-middle" />
              Stage
            </button>
            {stationDropdownOpen && (
              <div className="absolute bottom-full mb-2 left-0 bg-white text-slate-900 rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px]">
                {STATION_OPTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => handleBulkStation(s)}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-100 capitalize"
                  >
                    {s.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Change Priority dropdown */}
          <div className="relative" ref={priorityRef}>
            <button
              onClick={() => { setPriorityDropdownOpen(!priorityDropdownOpen); setStationDropdownOpen(false) }}
              disabled={bulkLoading}
              className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 rounded-lg transition whitespace-nowrap disabled:opacity-50"
            >
              <Icon name="priority_high" size="text-sm" className="mr-1 align-middle" />
              Priority
            </button>
            {priorityDropdownOpen && (
              <div className="absolute bottom-full mb-2 left-0 bg-white text-slate-900 rounded-lg shadow-xl border border-slate-200 py-1 min-w-[130px]">
                {PRIORITY_OPTIONS.map(p => (
                  <button
                    key={p}
                    onClick={() => handleBulkPriority(p)}
                    className="block w-full text-left px-3 py-2 text-sm hover:bg-slate-100 capitalize"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Delete */}
          <button
            onClick={handleBulkDelete}
            disabled={bulkLoading}
            className="text-sm px-3 py-1.5 bg-red-600 hover:bg-red-500 rounded-lg transition flex items-center gap-1.5 whitespace-nowrap disabled:opacity-50"
          >
            <Icon name="delete" size="text-sm" /> Delete
          </button>

          <div className="h-5 w-px bg-slate-600" />

          {/* Clear Selection */}
          <button
            onClick={() => setSelectedIds(new Set())}
            className="p-1.5 hover:bg-slate-700 rounded-lg transition"
            title="Clear selection"
          >
            <Icon name="close" size="text-sm" />
          </button>
        </div>
      )}

      {/* Feedback toast */}
      {actionFeedback && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-green-600 text-white text-sm font-medium px-4 py-2 rounded-lg shadow-lg">
          {actionFeedback}
        </div>
      )}
    </div>
  )
}
