'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Icon } from '@/components/ui/icon'
import { formatPhone, toProperCase } from '@/lib/format'

interface SearchResult {
  id: string
  full_name: string | null
  phone: string | null
  property_address: string | null
  city: string | null
  station: string | null
  priority: string | null
  updated_at: string
}

const STATION_COLORS: Record<string, string> = {
  intake: 'bg-slate-100 text-slate-600',
  new: 'bg-slate-100 text-slate-600',
  contacted: 'bg-blue-50 text-blue-700',
  qualifying: 'bg-blue-50 text-blue-700',
  qualified: 'bg-emerald-50 text-emerald-700',
  appt_set: 'bg-amber-50 text-amber-700',
  appointment: 'bg-amber-50 text-amber-700',
  discovery: 'bg-violet-50 text-violet-700',
  offer_made: 'bg-orange-50 text-orange-700',
  negotiations: 'bg-orange-50 text-orange-700',
  contract_signed: 'bg-green-50 text-green-700',
  under_contract: 'bg-green-50 text-green-700',
  closed: 'bg-slate-100 text-slate-500',
  dead: 'bg-slate-50 text-slate-400',
}

function stationLabel(station: string | null): string {
  if (!station) return 'New'
  return station.split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [loading, setLoading] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // This component is unmounted when closed, so state resets naturally.
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // Debounced fetch
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (q.length < 2) return
    const ctrl = new AbortController()
    const t = setTimeout(() => {
      setLoading(true)
      fetch(`/api/leads/search?q=${encodeURIComponent(q)}&limit=8`, { signal: ctrl.signal })
        .then((r) => r.json())
        .then((d) => {
          setResults(d.results || [])
          setActiveIndex(0)
        })
        .catch((e) => { if (e.name !== 'AbortError') setResults([]) })
        .finally(() => setLoading(false))
    }, 200)
    return () => {
      ctrl.abort()
      clearTimeout(t)
    }
  }, [query, open])

  // Keep active item in view
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.querySelector(`[data-idx="${activeIndex}"]`) as HTMLElement | null
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  function handleSelect(lead: SearchResult) {
    onClose()
    router.push(`/leads/${lead.id}`)
  }

  function handleKey(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => Math.min(i + 1, Math.max(visibleResults.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const lead = visibleResults[activeIndex]
      if (lead) handleSelect(lead)
    }
  }

  if (!open) return null

  const trimmed = query.trim()
  const showEmpty = trimmed.length < 2
  const searchActive = open && !showEmpty
  const visibleResults = searchActive ? results : []
  const visibleLoading = searchActive && loading
  const showNoMatch = searchActive && !visibleLoading && visibleResults.length === 0

  return (
    <div
      className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-sm flex items-start justify-center pt-[12vh] px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
          <Icon name="search" size="text-lg" className="text-slate-400" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Search leads by name, phone, or address…"
            className="flex-1 text-sm bg-transparent outline-none placeholder:text-slate-400"
          />
          {visibleLoading && (
            <Icon name="progress_activity" size="text-sm" className="text-slate-400 animate-spin" />
          )}
          <kbd className="hidden sm:inline-block text-[10px] font-bold text-slate-400 bg-slate-50 border border-slate-200 rounded px-1.5 py-0.5">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div ref={listRef} className="max-h-[50vh] overflow-y-auto">
          {showEmpty && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              <Icon name="keyboard" size="text-2xl" className="block mx-auto mb-2 text-slate-300" />
              Start typing a name, phone, or address
            </div>
          )}

          {showNoMatch && (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              <Icon name="search_off" size="text-2xl" className="block mx-auto mb-2 text-slate-300" />
              No matches for <span className="font-bold text-slate-600">&ldquo;{trimmed}&rdquo;</span>
            </div>
          )}

          {visibleResults.map((lead, idx) => {
            const isActive = idx === activeIndex
            const stationCls = STATION_COLORS[lead.station || ''] || 'bg-slate-100 text-slate-600'
            return (
              <button
                key={lead.id}
                data-idx={idx}
                type="button"
                onMouseEnter={() => setActiveIndex(idx)}
                onClick={() => handleSelect(lead)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors ${
                  isActive ? 'bg-slate-50' : 'hover:bg-slate-50'
                }`}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-slate-700 to-slate-900 text-white flex items-center justify-center text-xs font-black flex-shrink-0">
                  {(lead.full_name?.[0] || '?').toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {toProperCase(lead.full_name || '') || 'Unknown'}
                    </span>
                    {lead.priority === 'hot' && (
                      <Icon name="local_fire_department" size="text-xs" className="text-[#E32E2E] flex-shrink-0" />
                    )}
                  </div>
                  <div className="text-[11px] text-slate-500 truncate">
                    {lead.property_address ? (
                      <>
                        {lead.property_address}
                        {lead.city ? `, ${lead.city}` : ''}
                      </>
                    ) : lead.phone ? (
                      formatPhone(lead.phone)
                    ) : (
                      'No address'
                    )}
                  </div>
                </div>
                <span className={`text-[9px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md flex-shrink-0 ${stationCls}`}>
                  {stationLabel(lead.station)}
                </span>
                {isActive && (
                  <Icon name="keyboard_return" size="text-xs" className="text-slate-400 flex-shrink-0" />
                )}
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1">
              <kbd className="bg-white border border-slate-200 rounded px-1 font-bold">↑</kbd>
              <kbd className="bg-white border border-slate-200 rounded px-1 font-bold">↓</kbd>
              navigate
            </span>
            <span className="flex items-center gap-1">
              <kbd className="bg-white border border-slate-200 rounded px-1 font-bold">↵</kbd>
              open
            </span>
          </div>
          <span>
            Powered by <span className="font-bold text-slate-600">ARI</span>
          </span>
        </div>
      </div>
    </div>
  )
}
