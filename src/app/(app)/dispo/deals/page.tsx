'use client'

import { useState, useEffect, useRef } from 'react'
import { Icon } from '@/components/ui/icon'
import { cn } from '@/lib/utils'
import type { DealPage } from '@/types/dispo'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function getDealPageUrl(slug: string): string {
  return `${process.env.NEXT_PUBLIC_APP_URL ?? 'https://crm.savingkc.com'}/deals/${slug}`
}

// ---------------------------------------------------------------------------
// Create Deal Page Modal
// ---------------------------------------------------------------------------
interface Lead {
  id: string
  property_address: string | null
  full_name: string | null
}

function CreateDealPageModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [leadSearch, setLeadSearch] = useState('')
  const [leads, setLeads] = useState<Lead[]>([])
  const [searching, setSearching] = useState(false)
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [showAddress, setShowAddress] = useState(true)
  const [showArv, setShowArv] = useState(true)
  const [showAskingPrice, setShowAskingPrice] = useState(true)
  const [showAssignmentFee, setShowAssignmentFee] = useState(false)
  const [acceptOffers, setAcceptOffers] = useState(true)
  const [requiresRegistration, setRequiresRegistration] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  function debouncedSearchLeads(q: string) {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim()) { setLeads([]); setSearching(false); return }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(q)}&limit=10`)
        if (!res.ok) return
        const data = await res.json()
        setLeads(data.results ?? [])
      } finally {
        setSearching(false)
      }
    }, 400)
  }

  useEffect(() => { return () => { if (debounceRef.current) clearTimeout(debounceRef.current) } }, [])

  async function handleCreate() {
    if (!selectedLead) { setError('Please select a lead'); return }
    setError(null)
    setCreating(true)
    try {
      const res = await fetch('/api/deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_id: selectedLead.id,
          title: title || null,
          description: description || null,
          show_address: showAddress,
          show_arv: showArv,
          show_asking_price: showAskingPrice,
          show_assignment_fee: showAssignmentFee,
          accept_offers: acceptOffers,
          requires_registration: requiresRegistration,
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to create deal page')
      }
      onCreated()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create deal page')
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="text-lg font-bold text-slate-900">Create Deal Page</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-400">
            <Icon name="close" size="text-lg" />
          </button>
        </div>
        <div className="px-6 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
          )}

          {/* Lead Search */}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Select Lead *</label>
            <div className="relative">
              <input
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                value={leadSearch}
                onChange={e => { setLeadSearch(e.target.value); debouncedSearchLeads(e.target.value) }}
                placeholder="Search by address or name..."
              />
              {searching && (
                <div className="absolute inset-y-0 right-3 flex items-center">
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              )}
            </div>
            {leads.length > 0 && (
              <div className="mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {leads.map(lead => (
                  <button
                    key={lead.id}
                    onClick={() => {
                      setSelectedLead(lead)
                      setLeads([])
                      setLeadSearch(lead.property_address ?? lead.id)
                      setTitle(lead.property_address ?? '')
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b border-slate-50 last:border-0"
                  >
                    <p className="font-medium text-slate-900">{lead.property_address ?? 'Unknown address'}</p>
                    <p className="text-xs text-slate-500">{lead.full_name ?? ''}</p>
                  </button>
                ))}
              </div>
            )}
            {selectedLead && (
              <div className="mt-2 flex items-center gap-2 bg-primary/10 text-primary text-xs font-semibold rounded-lg px-3 py-2">
                <Icon name="check_circle" size="text-sm" />
                {selectedLead.property_address}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Page Title</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Great deal in 64112..."
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description</label>
            <textarea
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              rows={3}
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Describe the deal..."
            />
          </div>

          {/* Visibility toggles */}
          <div>
            <p className="text-xs font-bold text-slate-600 mb-2">Show on Page</p>
            <div className="space-y-2">
              {[
                { label: 'Property Address', val: showAddress, set: setShowAddress },
                { label: 'ARV', val: showArv, set: setShowArv },
                { label: 'Asking Price', val: showAskingPrice, set: setShowAskingPrice },
                { label: 'Assignment Fee', val: showAssignmentFee, set: setShowAssignmentFee },
                { label: 'Accept Offers', val: acceptOffers, set: setAcceptOffers },
                { label: 'Require Registration to View', val: requiresRegistration, set: setRequiresRegistration },
              ].map(({ label, val, set }) => (
                <label key={label} className="flex items-center gap-3 cursor-pointer">
                  <div
                    onClick={() => set(!val)}
                    className={cn(
                      'relative w-9 h-5 rounded-full transition-colors cursor-pointer',
                      val ? 'bg-primary' : 'bg-slate-200'
                    )}
                  >
                    <span className={cn(
                      'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform',
                      val ? 'translate-x-4' : 'translate-x-0'
                    )} />
                  </div>
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex gap-3 pt-2 pb-1">
            <button
              onClick={onClose}
              className="flex-1 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-4 py-2 text-sm font-semibold"
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={creating || !selectedLead}
              className="flex-1 bg-primary text-white hover:bg-primary/90 rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Create Page'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Deal Page Card
// ---------------------------------------------------------------------------
function DealPageCard({ page, onToggle, onCopied }: {
  page: DealPage & { property_address?: string }
  onToggle: (id: string, active: boolean) => void
  onCopied: () => void
}) {
  const url = getDealPageUrl(page.slug)

  function copyLink() {
    navigator.clipboard.writeText(url).catch(() => {})
    onCopied()
  }

  return (
    <div className={cn(
      'bg-white rounded-xl border shadow-sm overflow-hidden transition-all',
      page.is_active ? 'border-slate-100' : 'border-slate-100 opacity-70'
    )}>
      {/* Card header */}
      <div className={cn(
        'h-2 w-full',
        page.is_active ? 'bg-emerald-400' : 'bg-slate-200'
      )} />

      <div className="p-4">
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-slate-900 truncate text-sm">
              {page.title ?? (page as DealPage & { property_address?: string }).property_address ?? `Deal Page`}
            </h3>
            <p className="text-xs text-slate-500 mt-0.5 truncate">{url}</p>
          </div>
          <label className="relative inline-flex items-center cursor-pointer flex-shrink-0" title={page.is_active ? 'Active' : 'Inactive'}>
            <input
              type="checkbox"
              className="sr-only peer"
              checked={page.is_active}
              onChange={() => onToggle(page.id, !page.is_active)}
            />
            <div className="w-9 h-5 bg-slate-200 peer-checked:bg-emerald-500 rounded-full after:content-[''] after:absolute after:top-0.5 after:left-0.5 after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4 transition-colors" />
          </label>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2 mb-4">
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-slate-900">{page.view_count}</p>
            <p className="text-[10px] text-slate-500">Views</p>
          </div>
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-slate-900">{page.unique_visitors}</p>
            <p className="text-[10px] text-slate-500">Visitors</p>
          </div>
          <div className="text-center bg-slate-50 rounded-lg py-2">
            <p className="text-lg font-bold text-slate-900">—</p>
            <p className="text-[10px] text-slate-500">Offers</p>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-1 mb-4">
          {page.accept_offers && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">Accepts Offers</span>
          )}
          {page.requires_registration && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-yellow-100 text-yellow-700">Reg Required</span>
          )}
          {page.show_arv && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-600">ARV Shown</span>
          )}
        </div>

        <p className="text-[11px] text-slate-400 mb-3">Created {formatDate(page.created_at)}</p>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={copyLink}
            className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
          >
            <Icon name="content_copy" size="text-xs" />
            Copy Link
          </button>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 flex items-center justify-center gap-1.5 bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors"
            onClick={e => e.stopPropagation()}
          >
            <Icon name="open_in_new" size="text-xs" />
            View
          </a>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------
export default function DealPagesPage() {
  const [pages, setPages] = useState<(DealPage & { property_address?: string })[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function fetchPages() {
    setLoading(true)
    try {
      const res = await fetch('/api/deals')
      if (!res.ok) throw new Error('Failed to fetch deal pages')
      const data = await res.json()
      setPages(data.pages ?? [])
    } catch {
      setError('Failed to load deal pages')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchPages() }, [])

  async function handleToggle(id: string, active: boolean) {
    try {
      const res = await fetch(`/api/deals/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: active }),
      })
      if (!res.ok) return
      setPages(prev => prev.map(p => p.id === id ? { ...p, is_active: active } : p))
    } catch {
      // silently ignore
    }
  }

  function handleCopied() {
    setCopyFeedback(true)
    setTimeout(() => setCopyFeedback(false), 2000)
  }

  return (
    <div className="px-4 sm:px-6 lg:px-8 pt-6 pb-32 max-w-[1440px] mx-auto">
      {showCreate && (
        <CreateDealPageModal
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); fetchPages() }}
        />
      )}

      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white mb-1">Deal Pages</h1>
          <p className="text-slate-500 text-sm">
            {loading ? 'Loading…' : `${pages.length} deal page${pages.length !== 1 ? 's' : ''}`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-2 bg-[#E32E2E] text-white hover:bg-[#C42626] rounded-lg px-4 py-2 text-sm font-semibold self-start sm:self-auto"
        >
          <Icon name="add" size="text-sm" />
          Create Deal Page
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-4">
          {error}
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="text-slate-400 py-16 text-center">Loading deal pages...</div>
      ) : pages.length === 0 ? (
        <div className="text-center py-20">
          <Icon name="web" className="text-5xl text-slate-200 mb-4" />
          <p className="text-slate-400 font-medium text-lg">No deal pages yet</p>
          <p className="text-slate-400 text-sm mt-1 mb-6 max-w-sm mx-auto">
            Create one from a lead in disposition stage. Share the link with buyers to collect offers.
          </p>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-primary text-white hover:bg-primary/90 rounded-lg px-5 py-2.5 text-sm font-semibold"
          >
            Create First Deal Page
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {pages.map(page => (
            <DealPageCard
              key={page.id}
              page={page}
              onToggle={handleToggle}
              onCopied={handleCopied}
            />
          ))}
        </div>
      )}

      {/* Copy feedback toast */}
      {copyFeedback && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-4 py-2.5 rounded-lg shadow-xl flex items-center gap-2">
          <Icon name="check_circle" size="text-sm" className="text-emerald-400" />
          Link copied to clipboard
        </div>
      )}
    </div>
  )
}
